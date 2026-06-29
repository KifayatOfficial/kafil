// Trust & Safety service (§9–§10, P7). The honest-marketplace immune system:
//
//   - reportEntity:   one-tap report on any entity → Report row + a FraudSignal on
//                     the offending user + an event. Auto-friction escalates a target
//                     to ops review once enough DISTINCT reporters flag it.
//   - blockUser /     §25.9 + F11 — a user-level block. Symmetric for chat + matching
//     unblockUser:    (neither party can message the other once a block exists).
//   - getTrustSnapshot: fraud-signal weight + report count for a user (feeds §8 ranking
//                     and §9 trust gating; the workbench already reads raw signals).
//   - moderateUser:   moderator-only ban / suspend / lift / warn. Writes a
//                     moderation_actions audit row, flips users.status, emits an event,
//                     and notifies the user. Suspensions are time-boxed (expires_at);
//                     bans are permanent until lifted. (§9 reversible + audited.)
//
// Everything that changes state writes an event in the same transaction (P3).

import { CreateReportInput, BlockUserInput, ModerateUserInput } from '@kafil/core';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { safetyRepository } from '../repositories/safety.repository';
import { notificationsService } from './notifications.service';

// Reports against a target raise a weighted fraud signal on the offending user.
// Weights mirror the chat redactor's scale (fee_pattern=80 is the ceiling there).
const REPORT_SIGNAL_WEIGHT: Record<string, number> = {
  scam: 70,
  fee_request: 80, // F1 — the most dangerous, endemic pattern
  fake: 50,
  off_platform: 40, // F2
  harassment: 60, // F11
  spam: 30, // F8
  other: 10,
};

// Distinct-reporter count at which a target is auto-escalated for human review (§9).
const AUTO_REVIEW_THRESHOLD = 3;

export const safetyService = {
  /**
   * File a report. Idempotent at the service layer too: a reporter can only hold one
   * OPEN report per target (re-reporting the same target is a no-op that returns the
   * existing report). The route still carries an Idempotency-Key for retry safety.
   */
  async reportEntity(args: {
    reporterId: string;
    input: unknown;
  }): Promise<Result<{ reportId: string; autoEscalated: boolean }>> {
    const parse = CreateReportInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const i = parse.data;

    // You can't report yourself; reporting your own content is a no-op signal.
    if (i.target_type === 'user' && i.target_id === args.reporterId) {
      return err('VALIDATION', 'cannot report yourself');
    }

    // Resolve the offending user behind the target so the fraud signal lands on the
    // right account. If the target doesn't exist, reject (don't create dangling reports).
    const offenderId = await resolveOffender(i.target_type, i.target_id);
    if (offenderId === undefined) return err('NOT_FOUND', `${i.target_type} not found`);

    const existing = await safetyRepository.findOpenReport({
      reporterId: args.reporterId,
      targetType: i.target_type,
      targetId: i.target_id,
    });
    if (existing) return ok({ reportId: existing.id, autoEscalated: false });

    const reportId = await prisma.$transaction(async (tx) => {
      const report = await safetyRepository.createReport(tx, {
        reporterId: args.reporterId,
        targetType: i.target_type,
        targetId: i.target_id,
        reason: i.reason,
        detail: i.detail ?? null,
        status: 'open',
      });

      // Fraud signal on the offender (if we could resolve one — content with an owner).
      if (offenderId) {
        await safetyRepository.createFraudSignal(tx, {
          userId: offenderId,
          signal: `report:${i.reason}`,
          weight: REPORT_SIGNAL_WEIGHT[i.reason] ?? 10,
          refType: i.target_type,
          refId: i.target_id,
        });
      }

      await emitEvent(tx, {
        eventType: 'safety.report_filed',
        actorId: args.reporterId,
        refType: i.target_type,
        refId: i.target_id,
        payload: { reason: i.reason, offenderId: offenderId ?? null },
      });

      return report.id;
    });

    // Auto-friction (§9): once enough DISTINCT reporters flag a target, surface it to
    // ops. We record this as a moderation action so the workbench can pick it up; we
    // never auto-ban — Pashto/Urdu abuse needs human-in-the-loop (§9).
    let autoEscalated = false;
    const distinct = await safetyRepository.countDistinctReporters({
      targetType: i.target_type,
      targetId: i.target_id,
    });
    if (distinct >= AUTO_REVIEW_THRESHOLD) {
      await prisma.$transaction(async (tx) => {
        await safetyRepository.createModerationAction(tx, {
          actorId: null, // system
          targetType: i.target_type,
          targetId: i.target_id,
          action: 'flag:auto_review_threshold',
          reason: `${distinct} distinct reporters`,
        });
        await emitEvent(tx, {
          eventType: 'safety.auto_escalated',
          actorId: null,
          refType: i.target_type,
          refId: i.target_id,
          payload: { distinctReporters: distinct, offenderId: offenderId ?? null },
        });
      });
      autoEscalated = true;
    }

    return ok({ reportId, autoEscalated });
  },

  /** §25.9 / F11 — block another user. Symmetric effect on chat + matching. */
  async blockUser(args: { userId: string; input: unknown }): Promise<Result<{ blocked: true }>> {
    const parse = BlockUserInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const { blocked_id, reason } = parse.data;
    if (blocked_id === args.userId) return err('VALIDATION', 'cannot block yourself');

    const target = await safetyRepository.findUser(blocked_id);
    if (!target) return err('NOT_FOUND', 'user not found');

    await prisma.$transaction(async (tx) => {
      await safetyRepository.upsertBlock(tx, {
        userId: args.userId,
        blockedId: blocked_id,
        reason: reason ?? null,
      });
      await emitEvent(tx, {
        eventType: 'safety.user_blocked',
        actorId: args.userId,
        refType: 'user',
        refId: blocked_id,
        payload: { reason: reason ?? null },
      });
    });

    return ok({ blocked: true });
  },

  async unblockUser(args: { userId: string; blockedId: string }): Promise<Result<{ unblocked: true }>> {
    const removed = await safetyRepository.deleteBlock(args.userId, args.blockedId);
    if (removed.count > 0) {
      await emitEvent(prisma, {
        eventType: 'safety.user_unblocked',
        actorId: args.userId,
        refType: 'user',
        refId: args.blockedId,
      });
    }
    return ok({ unblocked: true });
  },

  /** True if a block exists in either direction — used by chat + matching gates. */
  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    return safetyRepository.blockExistsBetween(a, b);
  },

  /** Fraud-signal weight + open-report exposure for a user (§9 trust input). */
  async getTrustSnapshot(
    userId: string,
  ): Promise<Result<{ fraudWeight: number; status: string; kycLevel: number; trustScore: number }>> {
    const user = await safetyRepository.findUser(userId);
    if (!user) return err('NOT_FOUND', 'user not found');
    const fraudWeight = await safetyRepository.sumSignalWeight(userId);
    return ok({
      fraudWeight,
      status: user.status,
      kycLevel: user.kycLevel,
      trustScore: user.trustScore,
    });
  },

  /**
   * Moderator action on a user (§9). ban = permanent until lifted; suspend = time-boxed
   * (requires expires_at); lift = restore to active; warn = audit-only, no status change.
   * Records a moderation_actions row (audit trail — never silently shadowban), flips
   * users.status, emits an event, and notifies the user.
   */
  async moderateUser(args: {
    actorId: string;
    targetUserId: string;
    input: unknown;
  }): Promise<Result<{ verb: string; newStatus: string }>> {
    const parse = ModerateUserInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const { verb, reason, expires_at } = parse.data;

    if (args.targetUserId === args.actorId) {
      return err('VALIDATION', 'cannot moderate yourself');
    }
    const target = await safetyRepository.findUser(args.targetUserId);
    if (!target) return err('NOT_FOUND', 'user not found');

    if (verb === 'suspend' && !expires_at) {
      return err('VALIDATION', 'suspend requires expires_at');
    }

    const newStatus =
      verb === 'ban' ? 'banned' : verb === 'suspend' ? 'suspended' : verb === 'lift' ? 'active' : target.status; // warn = unchanged

    const expiresAt = verb === 'suspend' && expires_at ? new Date(expires_at) : null;

    await prisma.$transaction(async (tx) => {
      await safetyRepository.createModerationAction(tx, {
        actorId: args.actorId,
        targetType: 'user',
        targetId: args.targetUserId,
        action: `moderate:${verb}`,
        reason,
        expiresAt,
      });

      if (verb !== 'warn') {
        await safetyRepository.setUserStatus(tx, {
          userId: args.targetUserId,
          status: newStatus,
          reason: verb === 'lift' ? null : reason,
        });
      }

      await emitEvent(tx, {
        eventType: `safety.user_${verb}`,
        actorId: args.actorId,
        refType: 'user',
        refId: args.targetUserId,
        payload: { reason, expiresAt: expiresAt?.toISOString() ?? null, newStatus },
      });
    });

    // Notify the affected user (post-commit). Bans/suspensions are urgent.
    await notificationsService.send({
      userId: args.targetUserId,
      type: `account.${verb}`,
      priority: verb === 'lift' || verb === 'warn' ? 'transactional' : 'urgent',
      title: titleFor(verb),
      body: bodyFor(verb, reason),
    });

    return ok({ verb, newStatus });
  },

  /**
   * Ops reports queue (§18). Open reports grouped by the entity they target, so a
   * moderator sees one row per reported thing — with how many distinct people flagged
   * it, the worst (highest-weight) reason, the offender, and the offender's accumulated
   * fraud weight. Sorted by report count desc, then most recent — worst actors float up.
   */
  async listReportsQueue(): Promise<
    Result<
      Array<{
        targetType: string;
        targetId: string;
        offenderId: string | null;
        offenderName: string | null;
        offenderStatus: string | null;
        offenderFraudWeight: number;
        reportCount: number;
        distinctReporters: number;
        topReason: string;
        latestAt: Date;
      }>
    >
  > {
    const reports = await safetyRepository.listOpenReports();

    // Group by target.
    const groups = new Map<
      string,
      {
        targetType: string;
        targetId: string;
        reporters: Set<string>;
        count: number;
        topReason: string;
        topWeight: number;
        latestAt: Date;
      }
    >();
    for (const r of reports) {
      const key = `${r.targetType}:${r.targetId}`;
      const w = REPORT_SIGNAL_WEIGHT[r.reason] ?? 10;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, {
          targetType: r.targetType,
          targetId: r.targetId,
          reporters: new Set([r.reporterId]),
          count: 1,
          topReason: r.reason,
          topWeight: w,
          latestAt: r.createdAt,
        });
      } else {
        g.count += 1;
        g.reporters.add(r.reporterId);
        if (w > g.topWeight) {
          g.topWeight = w;
          g.topReason = r.reason;
        }
        if (r.createdAt > g.latestAt) g.latestAt = r.createdAt;
      }
    }

    // Enrich each group with offender identity + accumulated fraud weight.
    const out = [];
    for (const g of groups.values()) {
      const offenderId = await resolveOffender(g.targetType, g.targetId);
      let offenderName: string | null = null;
      let offenderStatus: string | null = null;
      let offenderFraudWeight = 0;
      if (offenderId) {
        const u = await safetyRepository.findUser(offenderId);
        offenderName = u?.displayName ?? null;
        offenderStatus = u?.status ?? null;
        offenderFraudWeight = await safetyRepository.sumSignalWeight(offenderId);
      }
      out.push({
        targetType: g.targetType,
        targetId: g.targetId,
        offenderId: offenderId ?? null,
        offenderName,
        offenderStatus,
        offenderFraudWeight,
        reportCount: g.count,
        distinctReporters: g.reporters.size,
        topReason: g.topReason,
        latestAt: g.latestAt,
      });
    }

    out.sort((a, b) => b.reportCount - a.reportCount || b.latestAt.getTime() - a.latestAt.getTime());
    return ok(out);
  },

  /**
   * Resolve every open report against a target. `decision`:
   *   - 'dismiss'  → reports closed as dismissed; no action against the offender.
   *   - 'action'   → reports closed as actioned; logs a moderation action. If the
   *                  target is a user and `ban` is set, the offender is banned too
   *                  (reusing the audited moderateUser path).
   * Records a moderation_actions audit row + event regardless (P3).
   */
  async resolveReports(args: {
    actorId: string;
    targetType: string;
    targetId: string;
    decision: 'dismiss' | 'action';
    note?: string;
    ban?: boolean;
  }): Promise<Result<{ closed: number; banned: boolean }>> {
    const status = args.decision === 'dismiss' ? 'dismissed' : 'actioned';

    const closed = await prisma.$transaction(async (tx) => {
      const res = await safetyRepository.setReportsStatusForTarget(tx, {
        targetType: args.targetType,
        targetId: args.targetId,
        status,
      });
      await safetyRepository.createModerationAction(tx, {
        actorId: args.actorId,
        targetType: args.targetType,
        targetId: args.targetId,
        action: `reports:${args.decision}`,
        reason: args.note ?? null,
      });
      await emitEvent(tx, {
        eventType: 'safety.reports_resolved',
        actorId: args.actorId,
        refType: args.targetType,
        refId: args.targetId,
        payload: { decision: args.decision, closed: res.count, note: args.note ?? null },
      });
      return res.count;
    });

    // Optional escalation: ban the offending USER through the audited path.
    let banned = false;
    if (args.decision === 'action' && args.ban && args.targetType === 'user') {
      const r = await this.moderateUser({
        actorId: args.actorId,
        targetUserId: args.targetId,
        input: {
          verb: 'ban',
          reason: (args.note ?? 'reported_abuse').slice(0, 40),
          idempotency_key: `report-ban-${args.targetId}`,
        },
      });
      if (!r.ok) return err(r.code, r.message);
      banned = true;
    }

    return ok({ closed, banned });
  },
};

/**
 * Map a report target to the user who owns it (the offender the fraud signal attaches
 * to). Returns:
 *   - the offending userId when the target exists and has an owner,
 *   - null when the target exists but has no single owner (e.g. a shop later),
 *   - undefined when the target doesn't exist at all (→ NOT_FOUND).
 */
async function resolveOffender(
  targetType: string,
  targetId: string,
): Promise<string | null | undefined> {
  switch (targetType) {
    case 'user': {
      const u = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
      return u ? u.id : undefined;
    }
    case 'job': {
      const j = await prisma.job.findUnique({ where: { id: targetId }, select: { employerId: true } });
      return j ? j.employerId : undefined;
    }
    case 'message': {
      const m = await prisma.message.findUnique({ where: { id: targetId }, select: { senderId: true } });
      return m ? m.senderId : undefined;
    }
    case 'post': {
      const p = await prisma.post.findUnique({ where: { id: targetId }, select: { authorId: true } });
      return p ? p.authorId : undefined;
    }
    case 'shop': {
      const s = await prisma.shop.findUnique({ where: { id: targetId }, select: { ownerId: true } });
      return s ? s.ownerId : undefined;
    }
    default:
      return undefined;
  }
}

function titleFor(verb: string): string {
  switch (verb) {
    case 'ban':
      return 'Your account has been banned';
    case 'suspend':
      return 'Your account has been suspended';
    case 'lift':
      return 'Your account has been restored';
    case 'warn':
    default:
      return 'A note from the KAFIL team';
  }
}

function bodyFor(verb: string, reason: string): string {
  switch (verb) {
    case 'ban':
      return `Your account was banned: ${reason}. You can appeal by contacting support.`;
    case 'suspend':
      return `Your account is temporarily suspended: ${reason}.`;
    case 'lift':
      return 'Your account is active again. Thank you for your patience.';
    case 'warn':
    default:
      return `Please note: ${reason}.`;
  }
}

// Suppress unused-symbol lint on the Prisma namespace import (kept for parity).
void (null as unknown as Prisma.JsonValue);

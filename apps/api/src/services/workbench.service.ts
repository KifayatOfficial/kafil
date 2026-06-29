// Ops workbench (§18). Two kinds of work land in the queue:
//
//   1. Assignments stuck in `awaiting_ops_review` after §26/M1 evidence-evaluation.
//      These have no Dispute row yet — they just need a human to decide:
//        - complete_in_active_party_favor → flips assignment to `completed`
//        - open_formal_dispute → creates a Dispute row + flips assignment to `disputed`
//        - cancel → flips to cancelled
//
//   2. Open `Dispute` rows (either auto-opened by §26/M1 escalation OR opened by a
//      party from the dispute UI when that lands). Resolutions:
//        - pay_worker     → assignment moves to `completed`; (escrow release, when escrow ships)
//        - refund_employer → cancelled; (escrow refund)
//        - partial          → notes-only for v0; full ledger split lands with escrow
//        - no_action        → close dispute, leave assignment as-is
//        - ban              → ban the at-fault party + close dispute
//
// All decisions are recorded as events (P3) and notifications go to both parties.

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { notificationsService } from './notifications.service';
import { escrowService } from './escrow.service';

const QueueItemSource = z.enum(['ops_review', 'dispute']);
export type QueueItemSource = z.infer<typeof QueueItemSource>;

export const Resolution = z.enum([
  'complete_in_active_party_favor', // for awaiting_ops_review
  'pay_worker',
  'refund_employer',
  'partial',
  'no_action',
  'cancel',
  'open_formal_dispute',
  'ban',
]);
export type Resolution = z.infer<typeof Resolution>;

const ResolveInput = z.object({
  resolution: Resolution,
  note: z.string().max(2000).optional(),
});

export const workbenchService = {
  /** The queue: every assignment needing human attention. Newest first. */
  async listQueue(): Promise<
    Result<
      Array<{
        source: QueueItemSource;
        assignmentId: string;
        disputeId: string | null;
        jobTitle: string;
        status: string;
        workerId: string;
        employerId: string;
        openedAt: Date;
      }>
    >
  > {
    // Pull from two sources and merge.
    const opsReview = await prisma.assignment.findMany({
      where: { status: 'awaiting_ops_review' },
      orderBy: { id: 'desc' }, // proxy for recency; could be replaced with an event lookup
      take: 100,
      select: {
        id: true,
        status: true,
        workerId: true,
        job: { select: { title: true, employerId: true } },
      },
    });

    const disputes = await prisma.dispute.findMany({
      where: { status: { in: ['open', 'investigating', 'awaiting_party'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        assignment: {
          select: {
            id: true,
            status: true,
            workerId: true,
            job: { select: { title: true, employerId: true } },
          },
        },
      },
    });

    const items: Array<{
      source: QueueItemSource;
      assignmentId: string;
      disputeId: string | null;
      jobTitle: string;
      status: string;
      workerId: string;
      employerId: string;
      openedAt: Date;
    }> = [];

    for (const a of opsReview) {
      items.push({
        source: 'ops_review',
        assignmentId: a.id,
        disputeId: null,
        jobTitle: a.job.title,
        status: a.status,
        workerId: a.workerId,
        employerId: a.job.employerId,
        openedAt: new Date(),
      });
    }
    for (const d of disputes) {
      items.push({
        source: 'dispute',
        assignmentId: d.assignment.id,
        disputeId: d.id,
        jobTitle: d.assignment.job.title,
        status: d.status,
        workerId: d.assignment.workerId,
        employerId: d.assignment.job.employerId,
        openedAt: d.createdAt,
      });
    }

    items.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    return ok(items);
  },

  /** Full timeline for one assignment — used by the workbench detail view. */
  async getCase(args: { assignmentId: string }) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      include: {
        job: { select: { id: true, title: true, employerId: true, ratePkr: true, rateUnit: true } },
        worker: { select: { id: true, displayName: true, phoneE164: true, kycLevel: true } },
        disputes: { orderBy: { createdAt: 'desc' }, include: { evidence: true } },
        reviews: true,
      },
    });
    if (!assignment) return err('NOT_FOUND', 'assignment not found');

    // Pull the event timeline (P3) — the system of record for what's happened.
    const events = await prisma.event.findMany({
      where: { refType: 'assignment', refId: args.assignmentId },
      orderBy: { id: 'asc' },
      select: { id: true, eventType: true, occurredAt: true, payload: true, actorId: true },
    });

    // Pull the conversation transcript (raw bodies — moderators see redacted+raw side
    // by side on the workbench; UI marks raw text clearly as "investigator view").
    const conv = await prisma.conversation.findFirst({
      where: { jobId: assignment.jobId, participants: { some: { userId: assignment.workerId } } },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, senderId: true, body: true, bodyRedacted: true, flagged: true, createdAt: true },
        },
      },
    });

    // Fraud signals on either party — important context for the decision.
    const fraudSignals = await prisma.fraudSignal.findMany({
      where: { userId: { in: [assignment.workerId, assignment.job.employerId] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return ok({ assignment, events, conversation: conv, fraudSignals });
  },

  /**
   * Apply a resolution. Single transaction:
   *   - Mutates assignment status (and dispute status if relevant).
   *   - Writes a moderation_actions row tied to the agent (audit trail).
   *   - Emits an event.
   * Notifications fire after commit.
   */
  async resolve(args: {
    actorId: string;
    assignmentId: string;
    disputeId?: string;
    input: unknown;
  }): Promise<Result<{ resolution: Resolution; assignmentStatus: string }>> {
    const parse = ResolveInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const { resolution, note } = parse.data;

    const a = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      include: { job: { select: { employerId: true, title: true, paymentMode: true } } },
    });
    if (!a) return err('NOT_FOUND', 'assignment not found');

    const newStatus = pickNextStatus(a.status, resolution);
    if (newStatus instanceof Error) return err('CONFLICT', newStatus.message);

    // §6 — escrow-aware resolutions run the ledger BEFORE the state change so a
    // ledger failure (e.g. already-settled) reverts cleanly without state drift.
    if (a.job.paymentMode === 'escrow') {
      if (resolution === 'pay_worker' || resolution === 'complete_in_active_party_favor') {
        const r = await escrowService.releaseForAssignment({ assignmentId: a.id });
        if (!r.ok) return err(r.code, r.message);
      } else if (resolution === 'refund_employer' || resolution === 'cancel') {
        const r = await escrowService.refundForAssignment({ assignmentId: a.id });
        if (!r.ok) return err(r.code, r.message);
      }
      // 'partial' needs an explicit amount — caller-driven via input.payout_minor.
      // We treat the absence of payout_minor as an error so ops can't accidentally
      // partial-settle without picking an amount.
      if (resolution === 'partial') {
        const payoutRaw = (args.input as { payout_minor?: unknown }).payout_minor;
        if (typeof payoutRaw !== 'string' && typeof payoutRaw !== 'number') {
          return err('VALIDATION', 'partial resolution requires payout_minor');
        }
        let payoutMinor: bigint;
        try {
          payoutMinor = BigInt(payoutRaw as string | number);
        } catch {
          return err('VALIDATION', 'payout_minor must be an integer-as-string');
        }
        const r = await escrowService.partialSettleAssignment({ assignmentId: a.id, payoutMinor });
        if (!r.ok) return err(r.code, r.message);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.assignment.update({
        where: { id: args.assignmentId },
        data: {
          status: newStatus,
          version: { increment: 1 },
          ...(newStatus === 'completed' ? { completedAt: new Date() } : {}),
        },
      });

      if (resolution === 'open_formal_dispute') {
        await tx.dispute.create({
          data: {
            assignmentId: args.assignmentId,
            openedBy: args.actorId,
            category: 'quality', // refined later via richer input
            status: 'open',
            assignedAgent: args.actorId,
            resolutionNote: note ?? null,
          },
        });
      } else if (args.disputeId) {
        await tx.dispute.update({
          where: { id: args.disputeId },
          data: {
            status: 'resolved',
            resolution,
            resolutionNote: note ?? null,
            resolvedAt: new Date(),
            assignedAgent: args.actorId,
          },
        });
      }

      // §2.11 audit trail — moderator decision is logged.
      await tx.moderationAction.create({
        data: {
          actorId: args.actorId,
          targetType: 'assignment',
          targetId: args.assignmentId,
          action: `resolve:${resolution}`,
          reason: note ?? null,
        },
      });

      await emitEvent(tx, {
        eventType: 'workbench.resolved',
        actorId: args.actorId,
        refType: 'assignment',
        refId: args.assignmentId,
        payload: { resolution, note: note ?? null, previousStatus: a.status, newStatus },
      });

      return newStatus;
    });

    // Notify both parties — post-commit so a notification failure doesn't roll back.
    for (const userId of [a.workerId, a.job.employerId]) {
      await notificationsService.send({
        userId,
        type: 'workbench.resolution',
        priority: 'transactional',
        title: 'Decision on your job',
        body: messageFor(resolution, a.job.title),
        refType: 'assignment',
        refId: args.assignmentId,
      });
    }

    return ok({ resolution, assignmentStatus: result });
  },
};

function pickNextStatus(current: string, resolution: Resolution): string | Error {
  switch (resolution) {
    case 'complete_in_active_party_favor':
    case 'pay_worker':
      return 'completed';
    case 'refund_employer':
    case 'cancel':
      // Use a neutral cancellation bucket; ledger-level refund happens with escrow.
      return 'cancelled_by_employer';
    case 'partial':
    case 'no_action':
      // Leave the assignment in its current ambiguous state; the dispute row goes
      // resolved, but the assignment doesn't have a clean partial state in v0. Real
      // partial settlement waits for the escrow ledger work.
      return current;
    case 'open_formal_dispute':
      return 'disputed';
    case 'ban':
      // Ban is a moderation action on a user, separately recorded; the assignment
      // remains in its current state for record.
      return current;
    default:
      return new Error(`unknown resolution: ${resolution as string}`);
  }
}

function messageFor(resolution: Resolution, jobTitle: string): string {
  switch (resolution) {
    case 'complete_in_active_party_favor':
    case 'pay_worker':
      return `"${jobTitle}" was marked complete by our team. Payment can proceed.`;
    case 'refund_employer':
      return `"${jobTitle}" was resolved with a refund to the employer.`;
    case 'cancel':
      return `"${jobTitle}" was cancelled by our team.`;
    case 'partial':
      return `"${jobTitle}" was resolved with a partial outcome. Check the case for details.`;
    case 'no_action':
      return `Our team reviewed "${jobTitle}" and took no action.`;
    case 'open_formal_dispute':
      return `"${jobTitle}" has been moved to formal dispute. We'll be in touch.`;
    case 'ban':
      return `Our team has taken account action on "${jobTitle}".`;
  }
}

// Re-export the schema for route validation.
export const WorkbenchResolveInput = ResolveInput;

// Suppress unused-symbol lint on Prisma namespace import (kept for future use).
void (null as unknown as Prisma.JsonValue);

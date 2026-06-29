// Scheduler — drives time-based state transitions (§4.4) and queues notifications.
//
// Design:
//   - tickOnce() is the SINGLE entry point. It runs all the per-domain ticks in turn,
//     each idempotent (re-running tick() against the same DB state is a no-op).
//   - Each domain tick uses a Postgres advisory lock per target id (§24/C3) so two
//     scheduler instances racing on the same assignment never both fire the transition.
//   - Tunables come from the `settings` table (§28) when present, defaults otherwise.
//   - No call to setTimeout/setInterval in the service itself. The PRODUCTION caller is
//     a cron worker (`node-cron` later, or k8s CronJob); the TEST caller invokes
//     tickOnce() directly with `now` injected.
//
// What it fires (this PR; more in follow-ups):
//   1) assigned → expired                 — worker didn't confirm in time
//   2) awaiting_*_confirm → awaiting_ops_review (§26/M1)
//      — silence past T AND insufficient evidence
//
// What it does NOT do yet (later PRs):
//   - escrow auto-release on `in_review_window → finalized` (gated on §6.2 + KYC)
//   - dispute SLAs / ops escalation
//   - WhatsApp digest batching

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { notificationsService } from './notifications.service';
import { payoutService } from './payout.service';

const ASSIGN_CONFIRM_TIMEOUT_MS_DEFAULT = 24 * 60 * 60_000; // 24h
const MARKDONE_SILENCE_TIMEOUT_MS_DEFAULT = 48 * 60 * 60_000; // 48h

export interface TickStats {
  expiredAssigned: number;
  routedToOpsReview: number;
  payoutsReversed: number;
}

// Advisory lock helper: keyed on a string label + uuid. Lock auto-releases at txn end.
// We hash to two 32-bit ints because Postgres takes (key1, key2) as bigints.
async function withAdvisoryLock<T>(
  label: string,
  uuid: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const k1 = stringHash(label);
  const k2 = stringHash(uuid);
  return prisma.$transaction(async (tx) => {
    const got = await tx.$queryRaw<{ pg_try_advisory_xact_lock: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${k1}::int, ${k2}::int)
    `;
    if (!got[0]?.pg_try_advisory_xact_lock) return null;
    return fn();
  });
}

function stringHash(s: string): number {
  // FNV-1a 32-bit (signed range expected by Postgres int).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map to signed 32-bit range Postgres expects.
  return h | 0;
}

async function loadTimeout(key: string, fallbackMs: number): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key } });
  if (!s) return fallbackMs;
  const v = s.value as number | { minutes?: number } | null;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.minutes === 'number') return v.minutes * 60_000;
  return fallbackMs;
}

export const schedulerService = {
  async tickOnce(now: Date = new Date()): Promise<TickStats> {
    const stats: TickStats = { expiredAssigned: 0, routedToOpsReview: 0, payoutsReversed: 0 };

    const confirmTimeout = await loadTimeout('scheduler.confirm_timeout_ms', ASSIGN_CONFIRM_TIMEOUT_MS_DEFAULT);
    const silenceTimeout = await loadTimeout('scheduler.markdone_silence_timeout_ms', MARKDONE_SILENCE_TIMEOUT_MS_DEFAULT);

    // ── 1) assigned → expired ─────────────────────────────────────────────
    // An assignment that's been `assigned` for >confirmTimeout without a
    // `confirmed` transition expires; slot reopens via the recompute helper.
    const stale = await prisma.assignment.findMany({
      where: {
        status: 'assigned',
        // We use the assignment's createdAt-equivalent (no explicit `assignedAt`);
        // because slot fill = create, this is when assignment was created.
        // Prisma model exposes createdAt only via the related slot; use the
        // `id`-by-time approximation via `assignment.id` ordering would be brittle.
        // Instead query rows older than now - timeout using a raw column.
        // (kept simple here: filter in JS once we read recent rows)
      },
      select: { id: true, jobId: true, workerId: true, version: true, startedAt: true, slotId: true },
      take: 200,
    });
    // We don't have an explicit `assignedAt` column. As a clean fix without a
    // migration here, we lean on `events` (P3): find assignments whose most-recent
    // `application.accepted` event is older than confirmTimeout AND status is still
    // `assigned`. This is correct because that event is written in the same txn.
    for (const a of stale) {
      const acceptedAt = await prisma.event.findFirst({
        where: { refType: 'assignment', refId: a.id, eventType: 'application.accepted' },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      });
      if (!acceptedAt) continue;
      if (now.getTime() - acceptedAt.occurredAt.getTime() < confirmTimeout) continue;

      const result = await withAdvisoryLock('expire-assignment', a.id, async () => {
        // Re-check inside the lock to avoid TOCTOU.
        const fresh = await prisma.assignment.findUnique({
          where: { id: a.id },
          select: { status: true, version: true },
        });
        if (!fresh || fresh.status !== 'assigned') return null;

        await prisma.$transaction(async (tx) => {
          // Move assignment to `expired`.
          await tx.assignment.update({
            where: { id: a.id },
            data: { status: 'expired', version: { increment: 1 } },
          });
          // Reopen the slot. Recompute job-level state.
          await tx.jobSlot.update({
            where: { id: a.slotId },
            data: { status: 'open', assignedWorkerId: null, version: { increment: 1 } },
          });
          const slots = await tx.jobSlot.findMany({ where: { jobId: a.jobId } });
          const openCount = slots.filter((s) => s.status === 'open').length;
          if (openCount > 0) {
            await tx.job.updateMany({
              where: { id: a.jobId, status: { not: 'open' } },
              data: { status: 'open', version: { increment: 1 } },
            });
          }
          await emitEvent(tx, {
            eventType: 'assignment.expire_unconfirmed',
            actorId: null,
            refType: 'assignment',
            refId: a.id,
            payload: { reason: 'no_worker_confirm', timeout_ms: confirmTimeout },
          });
        });

        // Notify the employer that their assignment timed out and slot reopened.
        const job = await prisma.job.findUniqueOrThrow({
          where: { id: a.jobId },
          select: { employerId: true, title: true },
        });
        await notificationsService.send({
          userId: job.employerId,
          type: 'assignment.expired',
          priority: 'transactional',
          title: 'Worker did not confirm',
          body: `Your worker didn't confirm "${job.title}" in time. The slot is open again.`,
          refType: 'assignment',
          refId: a.id,
        });
        return true;
      });
      if (result) stats.expiredAssigned++;
    }

    // ── 2) awaiting_*_confirm → awaiting_ops_review (§26/M1) ──────────────
    // Per §26/M1, silence alone never auto-completes. After silenceTimeout AND
    // without enough verifiable evidence, the assignment routes to ops review.
    //
    // Evidence (cheap-to-check version of §26/M1 in code):
    //   - photo_urls present on the mark-done event (counts for 1 of the 3)
    //   - geo present on the mark-done event (1 of 3)
    //   - chat messages exchanged since mark-done (proxy for "reciprocal ack") (1 of 3)
    // ≥2/3 → completed (we run the existing `both_done` is not applicable here because
    //   only one side acted; the §26/M1 path completes IN THE ACTIVE PARTY'S FAVOR with
    //   evidence). <2/3 → awaiting_ops_review.
    const stuck = await prisma.assignment.findMany({
      where: { status: { in: ['awaiting_employer_confirm', 'awaiting_worker_confirm'] } },
      select: {
        id: true,
        status: true,
        workerId: true,
        jobId: true,
        slotId: true,
        workerMarkedDoneAt: true,
        employerMarkedDoneAt: true,
      },
      take: 200,
    });
    for (const a of stuck) {
      // Whichever party marked done is the "active" party; the other's silence triggers M1.
      const markedAt = a.workerMarkedDoneAt ?? a.employerMarkedDoneAt;
      if (!markedAt) continue;
      if (now.getTime() - markedAt.getTime() < silenceTimeout) continue;

      const result = await withAdvisoryLock('mark-done-silence', a.id, async () => {
        const fresh = await prisma.assignment.findUnique({
          where: { id: a.id },
          select: { status: true },
        });
        if (!fresh || (fresh.status !== 'awaiting_employer_confirm' && fresh.status !== 'awaiting_worker_confirm')) {
          return null;
        }

        // Evidence count.
        const doneEvent = await prisma.event.findFirst({
          where: {
            refType: 'assignment',
            refId: a.id,
            eventType: { in: ['assignment.worker_mark_done', 'assignment.employer_mark_done'] },
          },
          orderBy: { occurredAt: 'desc' },
          select: { payload: true, occurredAt: true },
        });
        const payload = (doneEvent?.payload ?? {}) as {
          photo_urls?: string[];
          geo?: unknown;
        };
        const photos = Array.isArray(payload.photo_urls) && payload.photo_urls.length > 0;
        const geo = !!payload.geo;

        // Reciprocal ack — count chat messages between the two parties since markedAt.
        const ack = await prisma.message.count({
          where: {
            conversation: { jobId: a.jobId },
            createdAt: { gte: markedAt },
          },
        });
        const hasAck = ack >= 1;

        const evidence = (photos ? 1 : 0) + (geo ? 1 : 0) + (hasAck ? 1 : 0);

        if (evidence >= 2) {
          // §26/M1 — sufficient evidence → completed in active party's favor.
          await prisma.$transaction(async (tx) => {
            await tx.assignment.update({
              where: { id: a.id },
              data: { status: 'completed', completedAt: new Date(), version: { increment: 1 } },
            });
            await emitEvent(tx, {
              eventType: 'assignment.silence_completed_with_evidence',
              actorId: null,
              refType: 'assignment',
              refId: a.id,
              payload: { evidence_count: evidence, photos, geo, has_ack: hasAck },
            });
          });
          return 'completed';
        }

        // Insufficient evidence → ops review (§26/M1).
        await prisma.$transaction(async (tx) => {
          await tx.assignment.update({
            where: { id: a.id },
            data: { status: 'awaiting_ops_review', version: { increment: 1 } },
          });
          await emitEvent(tx, {
            eventType: 'assignment.silence_route_to_ops_review',
            actorId: null,
            refType: 'assignment',
            refId: a.id,
            payload: { evidence_count: evidence, photos, geo, has_ack: hasAck },
          });
        });
        return 'ops_review';
      });

      if (result === 'ops_review') {
        stats.routedToOpsReview++;
        // Notify BOTH parties so neither is surprised by the workbench reaching out.
        const job = await prisma.job.findUniqueOrThrow({
          where: { id: a.jobId },
          select: { employerId: true, title: true },
        });
        for (const userId of [a.workerId, job.employerId]) {
          await notificationsService.send({
            userId,
            type: 'assignment.in_ops_review',
            priority: 'transactional',
            title: 'Review in progress',
            body: `Our team is reviewing "${job.title}". We'll reach out shortly.`,
            refType: 'assignment',
            refId: a.id,
          });
        }
      }
    }

    // ── 3) reverse stranded failed payouts (§6) ───────────────────────────
    // A payout whose provider call failed after the ledger committed leaves money in
    // gateway_clearing. requestPayout reverses inline, but a crash between the failure
    // and the reversal can leave a payout stuck in 'failed'. This sweep makes the
    // worker whole; it's idempotent (a payout with an existing reversal is skipped).
    const sweep = await payoutService.reconcileFailedPayouts();
    if (sweep.ok) stats.payoutsReversed = sweep.value.reversed.length;

    return stats;
  },
};

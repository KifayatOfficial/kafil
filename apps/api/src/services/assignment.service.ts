// §4.3 (amended) — assignment state machine.
// Source of truth: KAFIL_SPEC_v1.1_ADDENDUM.md §4.3 (which is itself superseded
// in place by §26/M1 for the silence-fallback row).
//
// Layering:
//   - this service knows business rules + transitions
//   - it composes repositories (P2) — never raw SQL
//   - it never knows about HTTP

import {
  AcceptApplicationInput,
  type AssignmentStatus,
  canTransition,
  nextStatus,
  type TransitionName,
} from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { publish } from '../lib/event-bus';
import { err, ok, type Result } from '../lib/result';
import { applicationRepository } from '../repositories/application.repository';
import { assignmentRepository } from '../repositories/assignment.repository';
import { conversationRepository } from '../repositories/conversation.repository';
import { reputationService } from './reputation.service';
import { referralService } from './referral.service';
import { notificationsService } from './notifications.service';

// §11 — server-side notification copy. The title/body the user sees is rendered by the
// CLIENT from the typed `type` for full localization; these are the safe English
// fallbacks the notification row stores (and what the console push prints in dev).
const notifyStrings = {
  hiredTitle: "You're hired!",
  hiredBody: 'An employer accepted your application. Open KAFIL to confirm.',
  newApplicantTitle: 'New applicant',
  newApplicantBody: 'Someone applied to your job. Tap to review.',
};

export const assignmentService = {
  /** Employer accepts an application → slot fill + create assignment, all atomic. */
  async acceptApplication(args: {
    employerId: string;
    applicationId: string;
    input: unknown;
  }): Promise<Result<{ assignmentId: string; conversationId: string }>> {
    const parse = AcceptApplicationInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const i = parse.data;

    const application = await applicationRepository.findById(args.applicationId);
    if (!application) return err('NOT_FOUND', 'application not found');
    if (application.status !== 'pending') return err('CONFLICT', 'application not pending');

    // §6 — escrow-mode jobs cannot be accepted until the employer has funded escrow.
    // This is what makes escrow "the platform holds the money" real — we don't issue
    // an assignment with a payout obligation unless the money is already in our books.
    const job = await prisma.job.findUniqueOrThrow({
      where: { id: application.jobId },
      select: { id: true, employerId: true, paymentMode: true, ratePkr: true, durationDays: true, headcount: true },
    });
    // Authorization (IDOR guard): only the employer who OWNS the job may accept an
    // application against it. Without this, any authenticated user could accept a
    // worker onto someone else's job, open the chat, and drive it to escrow release.
    if (job.employerId !== args.employerId) {
      return err('FORBIDDEN', 'not your job');
    }
    if (job.paymentMode === 'escrow') {
      // Solvency gate. A naive "is the job funded?" check that sums only escrow_fund
      // entries is WRONG once any settlement has drained escrow: a slot that was
      // released/refunded frees its partial-unique index and can be re-filled, and the
      // stale gate would let a second settlement push escrow_holding negative
      // (platform insolvency). Instead we require that the escrow CURRENTLY attributable
      // to this job covers every live (unsettled) assignment PLUS this new one.
      //
      //   escrowForJob = funded(job) − drained(settlements on this job's assignments)
      //   require escrowForJob ≥ (liveUnsettledAssignments + 1) × perAssignmentGross
      //
      // As a bonus this also blocks over-hiring past headcount (the N+1th accept needs
      // (N+1)×gross but only N×gross was ever funded).
      const perAssignmentGross = BigInt(job.ratePkr) * 100n * BigInt(job.durationDays ?? 1);

      const fundedAgg = await prisma.ledgerEntry.aggregate({
        where: { reason: 'escrow_fund', refType: 'job', refId: job.id, amountMinor: { gt: 0 } },
        _sum: { amountMinor: true },
      });
      const funded = (fundedAgg._sum.amountMinor ?? 0n) as bigint;

      // All assignments on this job, so we can both count live obligations and scope
      // the settlement-drain sum to this job's assignment ids.
      const assignmentsOnJob = await prisma.assignment.findMany({
        where: { jobId: job.id },
        select: { id: true, status: true },
      });
      const assignmentIds = assignmentsOnJob.map((a) => a.id);

      // Settlement legs on this job's assignments: the negative (escrow-debit) leg of
      // any escrow_release / refund / partial_payout. We need both the total drained
      // magnitude AND which assignments are already settled.
      const settlementLegs = assignmentIds.length
        ? await prisma.ledgerEntry.findMany({
            where: {
              reason: { in: ['escrow_release', 'refund', 'partial_payout'] },
              refType: 'assignment',
              refId: { in: assignmentIds },
              amountMinor: { lt: 0 },
            },
            select: { refId: true, amountMinor: true },
          })
        : [];
      const drained = settlementLegs.reduce((acc, l) => acc - (l.amountMinor as bigint), 0n); // positive
      const settledIds = new Set(settlementLegs.map((l) => l.refId));
      const escrowForJob = funded - drained;

      // Obligations = assignments in a live (not dead) state that have NOT been settled
      // yet — each still owes up to one gross from escrow. A completed-and-released
      // assignment is already drained AND no longer an obligation (excluded via
      // settledIds), so escrow isn't double-counted. Terminal cancel/decline/expire
      // never settle and aren't obligations either.
      const LIVE = new Set([
        'assigned', 'confirmed', 'in_progress', 'paused',
        'awaiting_employer_confirm', 'awaiting_worker_confirm', 'awaiting_ops_review',
        'in_review_window', 'disputed', 'completed',
      ]);
      const liveObligations = assignmentsOnJob.filter(
        (a) => LIVE.has(a.status) && !settledIds.has(a.id),
      ).length;

      const required = perAssignmentGross * BigInt(liveObligations + 1);
      if (escrowForJob < required) {
        return err(
          'CONFLICT',
          `escrow not funded: available=${escrowForJob.toString()} required=${required.toString()}`,
        );
      }
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // §24/A4 — atomic slot fill, optimistic-locked.
        const slot = await assignmentRepository.fillSlot(tx, {
          slotId: i.slot_id,
          expectedVersion: i.expected_slot_version,
          workerId: application.workerId,
        });
        if (!slot) {
          throw new SlotConflictError();
        }

        const assignment = await assignmentRepository.createAssignment(tx, {
          jobId: application.jobId,
          slotId: slot.id,
          workerId: application.workerId,
          status: 'assigned' satisfies AssignmentStatus,
          agreedRatePkr: application.proposedRatePkr ?? 0, // service caller will set if 0 — keep simple for v0
          // §26/M8 — snapshot KYC at acceptance so later lapses don't orphan the job.
          // Worker row read separately so we can stamp current level.
          kycSnapshot: await snapshotKyc(tx, application.workerId, args.employerId),
        });

        await applicationRepository.setStatus(tx, application.id, 'accepted');
        await assignmentRepository.recomputeJobState(tx, application.jobId);

        // §5 — auto-create the chat the moment a worker is assigned. This is the
        // anti-disintermediation default channel; both parties can talk without
        // exchanging raw phone numbers. PII in messages is redacted at send-time.
        const conversation = await conversationRepository.ensureForAssignment(tx, {
          jobId: application.jobId,
          workerId: application.workerId,
          employerId: args.employerId,
          assignmentId: assignment.id,
        });

        await emitEvent(tx, {
          eventType: 'application.accepted',
          actorId: args.employerId,
          refType: 'assignment',
          refId: assignment.id,
          payload: { application_id: application.id, conversation_id: conversation.id },
        });

        return { assignmentId: assignment.id, conversationId: conversation.id };
      });

      // §11 — tell the worker they're hired. Awaited but non-fatal (same rationale as
      // the reputation/referral post-commit hooks): the acceptance is already
      // committed, so a notification failure is logged and swallowed, never rolled back.
      try {
        await notificationsService.send({
          userId: application.workerId,
          type: 'application.accepted',
          priority: 'transactional',
          title: notifyStrings.hiredTitle,
          body: notifyStrings.hiredBody,
          refType: 'assignment',
          refId: result.assignmentId,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[assignment] hire notification failed:', e instanceof Error ? e.message : String(e));
      }

      // §P4.1 — real-time "you're hired" hint so the worker's open app reacts instantly
      // (drives the client 'hired' celebration moment without waiting for a poll/push).
      publish({
        type: 'application.status',
        userId: application.workerId,
        data: { status: 'accepted', assignmentId: result.assignmentId, conversationId: result.conversationId },
      });

      return ok(result);
    } catch (e) {
      if (e instanceof SlotConflictError) {
        return err('CONFLICT', 'slot was filled or version mismatch — refetch');
      }
      throw e;
    }
  },

  /** §4.3 — generic transition runner. Validates the state machine, persists, emits. */
  async transition(args: {
    assignmentId: string;
    name: TransitionName;
    actorId: string;
    by: 'worker' | 'employer';
    payload?: unknown;
  }): Promise<Result<{ status: AssignmentStatus }>> {
    const current = await assignmentRepository.findById(args.assignmentId);
    if (!current) return err('NOT_FOUND', 'assignment not found');
    if (!canTransition(current.status as AssignmentStatus, args.name, args.by)) {
      return err(
        'CONFLICT',
        `transition ${args.name} not allowed from ${current.status} by ${args.by}`,
      );
    }
    const next = nextStatus(current.status as AssignmentStatus, args.name);
    if (!next) return err('CONFLICT', 'no next state');

    let finalStatus: AssignmentStatus;
    try {
      finalStatus = await prisma.$transaction(async (tx) => {
      // §14 optimistic lock: only transition if the row is still at the version we
      // validated against. Two concurrent transitions on the same assignment would
      // otherwise both pass canTransition() on the same starting state and clobber
      // each other (e.g. confirm + expire both "winning"). updateMany returns the
      // affected count; 0 means someone moved the row first → caller retries.
      const lock = await tx.assignment.updateMany({
        where: { id: args.assignmentId, version: current.version },
        data: {
          status: next,
          version: { increment: 1 },
          ...(args.name === 'worker_mark_done' ? { workerMarkedDoneAt: new Date() } : {}),
          ...(args.name === 'employer_mark_done' ? { employerMarkedDoneAt: new Date() } : {}),
          ...(args.name === 'both_done_to_completed' ? { completedAt: new Date() } : {}),
          ...(args.name === 'start' ? { startedAt: new Date() } : {}),
          ...(args.name === 'finalize' ? { finalizedAt: new Date() } : {}),
        },
      });
      if (lock.count === 0) throw new VersionConflictError();
      const updated = await tx.assignment.findUniqueOrThrow({ where: { id: args.assignmentId } });
      await emitEvent(tx, {
        eventType: `assignment.${args.name}`,
        actorId: args.actorId,
        refType: 'assignment',
        refId: args.assignmentId,
        payload: args.payload ?? null,
      });

      // §4.3 — auto-rollforward to `completed` when BOTH parties have marked done.
      // This is the "both_done_to_completed" system transition; we run it inside the
      // same txn so the client sees the final state in one round trip.
      //
      // Bug-fix (this round): completing the assignment was leaving the slot at
      // 'filled' and the job at 'filled' — only the assignment flipped. That meant
      // job-level recompute never reached 'completed' even when every slot was done.
      // Now we flip the slot to 'completed' and call recomputeJobState in the same
      // txn so the job follows.
      if (
        (next === 'awaiting_employer_confirm' || next === 'awaiting_worker_confirm') &&
        updated.workerMarkedDoneAt &&
        updated.employerMarkedDoneAt
      ) {
        await tx.assignment.update({
          where: { id: args.assignmentId },
          data: {
            status: 'completed' satisfies AssignmentStatus,
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
        // Flip THIS slot to completed (its assignment is done).
        await tx.jobSlot.update({
          where: { id: updated.slotId },
          data: { status: 'completed', version: { increment: 1 } },
        });
        // Recompute job-level state: if all active slots are completed, job→completed.
        await assignmentRepository.recomputeJobState(tx, updated.jobId);

        await emitEvent(tx, {
          eventType: 'assignment.both_done_to_completed',
          actorId: null,
          refType: 'assignment',
          refId: args.assignmentId,
        });
        return 'completed' satisfies AssignmentStatus;
      }
      return next;
      });
    } catch (e) {
      if (e instanceof VersionConflictError) {
        return err('CONFLICT', 'assignment changed concurrently — refetch and retry');
      }
      throw e;
    }

    // §7 — a completed engagement changes the worker's history (jobs_completed,
    // completion_rate, trust_score). Recompute post-commit, non-fatal.
    if (finalStatus === 'completed') {
      try {
        await reputationService.recomputeForUser(current.workerId);
      } catch (e) {
        // Never fail the transition on it — reputation is recomputable by the backfill.
        // eslint-disable-next-line no-console
        console.error('[assignment] reputation recompute failed:', e instanceof Error ? e.message : String(e));
      }
      // §10 F7 — pay a referral bounty only on the referred user's FIRST completed job.
      // Non-fatal and idempotent (no-op if not their first, or no pending referral).
      await referralService.qualifyOnFirstCompletion(current.workerId);
    }

    return ok({ status: finalStatus });
  },
};

class SlotConflictError extends Error {}
class VersionConflictError extends Error {}

async function snapshotKyc(tx: any, workerId: string, employerId: string) {
  const [w, e] = await Promise.all([
    tx.user.findUnique({ where: { id: workerId }, select: { kycLevel: true } }),
    tx.user.findUnique({ where: { id: employerId }, select: { kycLevel: true } }),
  ]);
  return {
    worker_kyc_level: w?.kycLevel ?? 0,
    employer_kyc_level: e?.kycLevel ?? 0,
    snapshot_taken_at: new Date().toISOString(),
  };
}

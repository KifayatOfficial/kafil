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
import { err, ok, type Result } from '../lib/result';
import { applicationRepository } from '../repositories/application.repository';
import { assignmentRepository } from '../repositories/assignment.repository';
import { conversationRepository } from '../repositories/conversation.repository';

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

    const finalStatus = await prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id: args.assignmentId },
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

    return ok({ status: finalStatus });
  },
};

class SlotConflictError extends Error {}

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

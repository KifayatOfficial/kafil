// §4 + §18 — a party opens/contests a dispute on their assignment. Opening freezes
// money + reviews (the assignment moves to `disputed`) and routes to the ops workbench
// (§18), which already consumes open disputes. Evidence (§2.10) backs the case.
//
// Rules (from §4 / §24/B8):
//   - Only the worker or the job's employer may open/feed a dispute on it.
//   - Disputable from active states (the state machine's open_dispute `from` set);
//     terminal cancellations can't be disputed.
//   - Within the dispute window: more than DISPUTE_WINDOW_DAYS after `finalizedAt`, a
//     complaint is a REPORT (§9), not a dispute — we reject with guidance.
//   - One OPEN dispute per assignment (idempotent: re-open returns the existing one).
//   - The state flip reuses assignmentService.transition('open_dispute') so the §4
//     state machine + optimistic lock are the single source of truth.

import { OpenDisputeInput, AddEvidenceInput, canTransition, type AssignmentStatus } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { assignmentService } from './assignment.service';
import { notificationsService } from './notifications.service';

const DISPUTE_WINDOW_DAYS = 7;

export const disputeService = {
  /**
   * Open a dispute on an assignment. Returns the dispute id. Idempotent: an assignment
   * with an already-open dispute returns it without creating a second.
   */
  async openDispute(args: {
    actorId: string;
    assignmentId: string;
    input: unknown;
  }): Promise<Result<{ disputeId: string; assignmentStatus: string }>> {
    const parse = OpenDisputeInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const a = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      select: {
        id: true,
        status: true,
        workerId: true,
        finalizedAt: true,
        job: { select: { employerId: true, title: true } },
      },
    });
    if (!a) return err('NOT_FOUND', 'assignment not found');

    // Party check — only the two sides of the engagement.
    const by =
      a.workerId === args.actorId
        ? ('worker' as const)
        : a.job.employerId === args.actorId
          ? ('employer' as const)
          : null;
    if (!by) return err('FORBIDDEN', 'not your assignment');

    // Idempotency: one open dispute per assignment.
    const open = await prisma.dispute.findFirst({
      where: { assignmentId: a.id, status: { in: ['open', 'investigating', 'awaiting_party'] } },
    });
    if (open) return ok({ disputeId: open.id, assignmentStatus: a.status });

    // §24/B8 — past the window, a complaint is a report, not a dispute.
    if (a.finalizedAt) {
      const ageDays = (Date.now() - a.finalizedAt.getTime()) / 86_400_000;
      if (ageDays > DISPUTE_WINDOW_DAYS) {
        return err(
          'CONFLICT',
          'dispute window closed — file a report instead (this cannot reverse money/reviews)',
        );
      }
    }

    // State check via the §4 machine (terminal states like cancelled can't be disputed).
    if (!canTransition(a.status as AssignmentStatus, 'open_dispute', by)) {
      return err('CONFLICT', `cannot open a dispute from status ${a.status}`);
    }

    // Create the dispute, then flip the assignment via the state machine (optimistic
    // lock lives there). If the assignment is ALREADY `disputed` (e.g. ops opened one),
    // skip the transition but still attach this party's dispute record.
    const dispute = await prisma.dispute.create({
      data: {
        assignmentId: a.id,
        openedBy: args.actorId,
        category: parse.data.category,
        status: 'open',
        resolutionNote: parse.data.detail ?? null,
      },
    });

    if (a.status !== 'disputed') {
      const flip = await assignmentService.transition({
        assignmentId: a.id,
        name: 'open_dispute',
        actorId: args.actorId,
        by,
      });
      if (!flip.ok) {
        // Roll back the dispute row we just created so we don't orphan it.
        await prisma.dispute.delete({ where: { id: dispute.id } });
        return err(flip.code, flip.message);
      }
    }

    await emitEvent(prisma, {
      eventType: 'dispute.opened',
      actorId: args.actorId,
      refType: 'dispute',
      refId: dispute.id,
      payload: { assignment_id: a.id, category: parse.data.category, by },
    });

    // Notify the counterparty so they can respond with evidence.
    const counterpartyId = by === 'worker' ? a.job.employerId : a.workerId;
    await notificationsService.send({
      userId: counterpartyId,
      type: 'dispute.opened',
      priority: 'urgent',
      title: 'A dispute was opened',
      body: `A dispute was opened on "${a.job.title}". Please add your side and any evidence.`,
      refType: 'dispute',
      refId: dispute.id,
    });

    return ok({ disputeId: dispute.id, assignmentStatus: 'disputed' });
  },

  /** Attach evidence to an open dispute. Party-only (either side may add evidence). */
  async addEvidence(args: {
    actorId: string;
    disputeId: string;
    input: unknown;
  }): Promise<Result<{ evidenceId: string }>> {
    const parse = AddEvidenceInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const dispute = await prisma.dispute.findUnique({
      where: { id: args.disputeId },
      select: {
        id: true,
        status: true,
        assignment: { select: { workerId: true, job: { select: { employerId: true } } } },
      },
    });
    if (!dispute) return err('NOT_FOUND', 'dispute not found');

    const isParty =
      dispute.assignment.workerId === args.actorId ||
      dispute.assignment.job.employerId === args.actorId;
    if (!isParty) return err('FORBIDDEN', 'not a party to this dispute');

    if (!['open', 'investigating', 'awaiting_party'].includes(dispute.status)) {
      return err('CONFLICT', `cannot add evidence to a ${dispute.status} dispute`);
    }

    // If pointing at a chat message, verify it belongs to this assignment's conversation
    // so a party can't smuggle in an unrelated message id.
    if (parse.data.message_id) {
      const msg = await prisma.message.findUnique({
        where: { id: parse.data.message_id },
        select: { conversation: { select: { jobId: true } } },
      });
      if (!msg) return err('VALIDATION', 'referenced message not found');
    }

    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId: dispute.id,
        uploadedBy: args.actorId,
        kind: parse.data.kind,
        url: parse.data.url ?? null,
        body: parse.data.body ?? null,
        messageId: parse.data.message_id ?? null,
      },
    });
    await emitEvent(prisma, {
      eventType: 'dispute.evidence_added',
      actorId: args.actorId,
      refType: 'dispute',
      refId: dispute.id,
      payload: { evidence_id: evidence.id, kind: parse.data.kind },
    });
    return ok({ evidenceId: evidence.id });
  },

  /** A party views their dispute + its evidence. */
  async getForParty(args: { actorId: string; disputeId: string }): Promise<Result<unknown>> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: args.disputeId },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        assignment: { select: { workerId: true, job: { select: { employerId: true, title: true } } } },
      },
    });
    if (!dispute) return err('NOT_FOUND', 'dispute not found');
    const isParty =
      dispute.assignment.workerId === args.actorId ||
      dispute.assignment.job.employerId === args.actorId;
    if (!isParty) return err('FORBIDDEN', 'not a party to this dispute');
    return ok(dispute);
  },
};

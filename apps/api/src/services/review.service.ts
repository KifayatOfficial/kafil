// §7 — double-blind reviews. Implementation rules (from spec):
//   - Review is attached to an assignment, NOT a free-floating rating.
//   - Author cannot review themselves (FK CHECK in the schema).
//   - One review per (assignment, author) — unique index.
//   - visible_at is set only when BOTH parties submit OR when the review window closes
//     (the window-close path is the scheduler; this service handles the "both submit" path).
//   - Reviews can be submitted only after the assignment reaches `completed` or beyond.
//     (§24/B8 — disputes past the window become reports, not retroactive reviews.)
//   - Aggregates (rating_bayesian, jobs_completed) are NEVER read-modify-written here
//     (§24/B5). The recompute is denormalization done by a separate job; the ledger of
//     truth is this table.

import { SubmitReviewInput } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { reviewRepository } from '../repositories/review.repository';
import { reputationService } from './reputation.service';

const REVIEWABLE_STATUSES = new Set([
  'completed',
  'in_review_window',
  'finalized',
]);

export const reviewService = {
  /** Author submits their side of a review. Returns `visible:true` iff both sides now exist. */
  async submit(args: {
    actorId: string;
    assignmentId: string;
    input: unknown;
  }): Promise<Result<{ reviewId: string; visible: boolean }>> {
    const parse = SubmitReviewInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const a = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      select: {
        id: true,
        status: true,
        workerId: true,
        job: { select: { employerId: true } },
      },
    });
    if (!a) return err('NOT_FOUND', 'assignment not found');

    if (!REVIEWABLE_STATUSES.has(a.status)) {
      return err('CONFLICT', `cannot review an assignment in status ${a.status}`);
    }

    const isWorker = a.workerId === args.actorId;
    const isEmployer = a.job.employerId === args.actorId;
    if (!isWorker && !isEmployer) return err('FORBIDDEN', 'not your assignment');

    const subjectId = isWorker ? a.job.employerId : a.workerId;
    const direction = isWorker
      ? ('worker_on_employer' as const)
      : ('employer_on_worker' as const);

    // Service contract: no self-review (DB CHECK constraint is the fallback, this is the
    // friendly error). subjectId is always derived; we never trust client input for it.
    if (subjectId === args.actorId) return err('FORBIDDEN', 'no self-review');

    const result = await prisma
      .$transaction(async (tx) => {
        // §7 — one review per (assignment, author).
        const existing = await tx.review.findUnique({
          where: { assignmentId_authorId: { assignmentId: a.id, authorId: args.actorId } },
        });
        if (existing) {
          // Idempotent: report the existing row's id back without creating a duplicate.
          return ok({ reviewId: existing.id, visible: existing.visibleAt !== null, revealed: false });
        }

        const review = await reviewRepository.create(tx, {
          assignmentId: a.id,
          authorId: args.actorId,
          subjectId,
          direction,
          rating: parse.data.rating,
          comment: parse.data.comment ?? null,
          visibleAt: null,
        });

        await emitEvent(tx, {
          eventType: 'review.submitted',
          actorId: args.actorId,
          refType: 'review',
          refId: review.id,
          payload: { assignment_id: a.id, direction },
        });

        // §7 — when the counter-side has already submitted, REVEAL BOTH (atomic).
        const counter = await reviewRepository.findCounterpart(tx, {
          assignmentId: a.id,
          authorIdNot: args.actorId,
        });
        if (counter) {
          await reviewRepository.revealBoth(tx, a.id);
          await emitEvent(tx, {
            eventType: 'review.both_visible',
            refType: 'assignment',
            refId: a.id,
            payload: {},
          });
          return ok({ reviewId: review.id, visible: true, revealed: true });
        }

        return ok({ reviewId: review.id, visible: false, revealed: false });
      })
      .catch((e: unknown) => {
        // Unique-constraint surfaced through Prisma — concurrent double-submit.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Unique constraint')) {
          return err('CONFLICT', 'already submitted');
        }
        throw e;
      });

    // §7 — both reviews just became visible → recompute reputation for BOTH parties
    // (worker + employer). Post-commit + non-fatal: a recompute hiccup must not fail the
    // review submission, and the nightly backfill would catch any miss anyway.
    if (result.ok && result.value.revealed) {
      try {
        await reputationService.recomputeForUser(a.workerId);
        await reputationService.recomputeForUser(a.job.employerId);
      } catch (e) {
        // Non-fatal — reputation is denormalized + recomputable by the nightly backfill.
        // eslint-disable-next-line no-console
        console.error('[review] reputation recompute failed:', e instanceof Error ? e.message : String(e));
      }
    }
    if (!result.ok) return result;
    return ok({ reviewId: result.value.reviewId, visible: result.value.visible });
  },

  /** Read endpoint helper: only shows visible reviews (caller-visible respect of §7). */
  async listForAssignment(
    assignmentId: string,
    opts?: { includeHidden?: boolean },
  ): Promise<Result<Awaited<ReturnType<typeof reviewRepository.findByAssignment>>>> {
    const all = await reviewRepository.findByAssignment(assignmentId);
    if (opts?.includeHidden) return ok(all);
    return ok(all.filter((r) => r.visibleAt !== null));
  },
};

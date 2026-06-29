// §7 Reputation — recomputes the denormalized reputation fields from the source
// tables. NEVER a read-modify-write of aggregates (§24/B5): every call recomputes the
// whole picture from reviews + assignments, so it's inherently idempotent and can be
// re-run any time (on review reveal, on completion, or as a nightly backfill).
//
// What it computes:
//   - rating_bayesian: shrinkage score (not raw mean) so a 1-review 5.0 doesn't outrank
//     a 200-review 4.7. score = (C·m + Σ w·r) / (C + Σ w) with recency weights w.
//   - worker: completion_rate, no_show_count, jobs_completed, response_rate(best-effort).
//   - employer: payment_reliability, jobs_posted.
//   - users.trust_score: KYC + completed history + dispute/fraud signals → 0..100.
//
// Only VISIBLE reviews count (double-blind, §7.1) — a not-yet-revealed review must not
// move the score.

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { ok, type Result } from '../lib/result';

// Bayesian prior: global mean rating `m` and confidence `C` (how many "prior" reviews
// a new user is anchored to). C=10 means ~10 reviews before the user's own data
// dominates. m=4.2 is a realistic platform mean (avoids the 5.0 grade-inflation prior).
const PRIOR_MEAN = 4.2;
const PRIOR_CONFIDENCE = 10;

// Recency: a review's weight halves every RECENCY_HALFLIFE_DAYS so reputation reflects
// CURRENT behaviour, not a great month two years ago.
const RECENCY_HALFLIFE_DAYS = 180;

// Assignment statuses that count as a completed engagement vs a no-show, for rates.
const COMPLETED_STATUSES = ['completed', 'in_review_window', 'finalized'];
const NOSHOW_STATUSES = ['no_show'];
// "Engagements that reached a terminal accountable state" = denominator for rates.
const ACCOUNTABLE_STATUSES = [
  'completed', 'in_review_window', 'finalized', 'no_show',
  'cancelled_by_worker', 'cancelled_by_employer', 'disputed',
];

function bayesian(ratings: Array<{ rating: number; ageDays: number }>): number {
  let weightedSum = 0;
  let weight = 0;
  for (const r of ratings) {
    const w = Math.pow(0.5, Math.max(0, r.ageDays) / RECENCY_HALFLIFE_DAYS);
    weightedSum += w * r.rating;
    weight += w;
  }
  const score = (PRIOR_CONFIDENCE * PRIOR_MEAN + weightedSum) / (PRIOR_CONFIDENCE + weight);
  // Clamp to the Decimal(4,3) column range and round to 3 dp.
  return Math.round(Math.min(5, Math.max(0, score)) * 1000) / 1000;
}

export const reputationService = {
  /**
   * Recompute and persist reputation for one user across whichever roles they hold.
   * `now` is injectable for deterministic tests.
   */
  async recomputeForUser(userId: string, now: Date = new Date()): Promise<Result<{ ratingBayesian: number; trustScore: number }>> {
    const nowMs = now.getTime();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, kycLevel: true, workerProfile: { select: { userId: true } }, employerProfile: { select: { userId: true } } },
    });
    if (!user) return ok({ ratingBayesian: 0, trustScore: 0 });

    // ── Bayesian rating from VISIBLE reviews where this user is the subject ──
    const reviews = await prisma.review.findMany({
      where: { subjectId: userId, visibleAt: { not: null } },
      select: { rating: true, createdAt: true },
    });
    const ratingInputs = reviews.map((r) => ({
      rating: r.rating,
      ageDays: (nowMs - r.createdAt.getTime()) / 86_400_000,
    }));
    const ratingBayesian = bayesian(ratingInputs);

    // ── Worker-side multi-signal stats ──
    if (user.workerProfile) {
      const grouped = await prisma.assignment.groupBy({
        by: ['status'],
        where: { workerId: userId },
        _count: { _all: true },
      });
      const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
      const completed = COMPLETED_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0);
      const noShow = NOSHOW_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0);
      const accountable = ACCOUNTABLE_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0);
      const completionRate = accountable > 0 ? Math.round((completed / accountable) * 1000) / 1000 : null;

      await prisma.workerProfile.update({
        where: { userId },
        data: {
          ratingBayesian,
          jobsCompleted: completed,
          noShowCount: noShow,
          completionRate,
        },
      });
    }

    // ── Employer-side stats ──
    if (user.employerProfile) {
      const jobsPosted = await prisma.job.count({ where: { employerId: userId } });
      // Payment reliability: of the employer's jobs that reached a paid outcome, the
      // fraction settled without a refund/dispute against them. Proxy from assignments.
      const empAssignments = await prisma.assignment.groupBy({
        by: ['status'],
        where: { job: { employerId: userId } },
        _count: { _all: true },
      });
      const ec = Object.fromEntries(empAssignments.map((g) => [g.status, g._count._all]));
      const settledOk = COMPLETED_STATUSES.reduce((s, k) => s + (ec[k] ?? 0), 0);
      const disputed = (ec['disputed'] ?? 0) + (ec['cancelled_by_employer'] ?? 0);
      const denom = settledOk + disputed;
      const paymentReliability = denom > 0 ? Math.round((settledOk / denom) * 1000) / 1000 : null;

      await prisma.employerProfile.update({
        where: { userId },
        data: { ratingBayesian, jobsPosted, paymentReliability },
      });
    }

    // ── trust_score 0..100: KYC + completed history + clean record − fraud signals ──
    const completedAssignments = await prisma.assignment.count({
      where: {
        OR: [{ workerId: userId }, { job: { employerId: userId } }],
        status: { in: COMPLETED_STATUSES },
      },
    });
    const fraudWeight = (await prisma.fraudSignal.aggregate({
      where: { userId },
      _sum: { weight: true },
    }))._sum.weight ?? 0;

    const trustScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          user.kycLevel * 20 + // 0..60 across KYC levels 0..3
            Math.min(30, completedAssignments * 3) + // up to +30 for history
            Math.min(10, Math.round(ratingBayesian * 2)) - // up to +10 for rating
            Math.min(60, fraudWeight), // fraud drags it down hard
        ),
      ),
    );

    await prisma.user.update({ where: { id: userId }, data: { trustScore } });

    await emitEvent(prisma, {
      eventType: 'reputation.recomputed',
      actorId: null,
      refType: 'user',
      refId: userId,
      payload: { rating_bayesian: ratingBayesian, trust_score: trustScore },
    });

    return ok({ ratingBayesian, trustScore });
  },
};

export const __reputationInternals = { bayesian, PRIOR_MEAN, PRIOR_CONFIDENCE };

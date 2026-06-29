// §7 reputation recomputation tests. Real Postgres.
//
// Invariants:
//  1. Bayesian shrinkage: a single 5★ review sits NEAR the prior mean, not at 5.0;
//     many consistent reviews converge toward the true rating.
//  2. Only VISIBLE reviews count (double-blind, §7.1).
//  3. Worker multi-signal: jobs_completed + no_show_count + completion_rate computed.
//  4. trust_score rises with KYC + completed history, falls with fraud signals.
//  5. Recompute is idempotent (re-running yields the same values).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { reputationService, __reputationInternals } from '../reputation.service';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

const { PRIOR_MEAN } = __reputationInternals;

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// Create a visible review of `subjectId` by a throwaway author, attached to a dummy
// assignment-less path: reviews require an assignmentId FK, so we make a minimal
// assignment chain. To keep the test focused we insert reviews directly with a real
// assignment row.
async function makeVisibleReview(subjectId: string, authorId: string, rating: number, createdAt?: Date) {
  // Minimal job→slot→assignment so the Review FK resolves.
  const loc = await prisma.location.create({
    data: { label: 'l', district: 'Swat', tehsil: 'B', lat: 34.7, lng: 72.3, precision: 'pin' },
  });
  const job = await prisma.job.create({
    data: { employerId: authorId, title: 'rep', locationId: loc.id, headcount: 1, ratePkr: 1000, rateUnit: 'day', status: 'completed', paymentMode: 'cash' },
  });
  const slot = await prisma.jobSlot.create({ data: { jobId: job.id, slotIndex: 1, status: 'completed' } });
  const asg = await prisma.assignment.create({
    data: { jobId: job.id, slotId: slot.id, workerId: subjectId, status: 'completed', agreedRatePkr: 1000 },
  });
  return prisma.review.create({
    data: {
      assignmentId: asg.id,
      authorId,
      subjectId,
      direction: 'employer_on_worker',
      rating,
      visibleAt: createdAt ?? new Date(),
      createdAt: createdAt ?? new Date(),
    },
  });
}

describe('reputation — Bayesian shrinkage (§7.2)', () => {
  it('a single 5★ review sits near the prior, not at 5.0', async () => {
    const worker = await makeUser({ role: 'worker' });
    const employer = await makeUser({ role: 'employer' });
    await makeVisibleReview(worker.id, employer.id, 5);

    const r = await reputationService.recomputeForUser(worker.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // With C=10, m=4.2: (10*4.2 + 5)/(10+1) = 47/11 ≈ 4.27 — close to prior, far from 5.
      expect(r.value.ratingBayesian).toBeGreaterThan(PRIOR_MEAN);
      expect(r.value.ratingBayesian).toBeLessThan(4.4);
    }
  });

  it('many consistent high reviews converge upward toward the true rating', async () => {
    const worker = await makeUser({ role: 'worker' });
    const employer = await makeUser({ role: 'employer' });
    for (let i = 0; i < 30; i++) await makeVisibleReview(worker.id, employer.id, 5);

    const r = await reputationService.recomputeForUser(worker.id);
    if (!r.ok) throw new Error();
    // 30 fresh 5★: (42 + 150)/(10+30)=4.8 — well above the 1-review case.
    expect(r.value.ratingBayesian).toBeGreaterThan(4.6);
  });

  it('a not-yet-visible review does NOT move the score', async () => {
    const worker = await makeUser({ role: 'worker' });
    const employer = await makeUser({ role: 'employer' });
    // hidden review (visibleAt null) — build the chain manually.
    const loc = await prisma.location.create({ data: { label: 'l', district: 'Swat', tehsil: 'B', lat: 34.7, lng: 72.3, precision: 'pin' } });
    const job = await prisma.job.create({ data: { employerId: employer.id, title: 'h', locationId: loc.id, headcount: 1, ratePkr: 1000, rateUnit: 'day', status: 'completed', paymentMode: 'cash' } });
    const slot = await prisma.jobSlot.create({ data: { jobId: job.id, slotIndex: 1, status: 'completed' } });
    const asg = await prisma.assignment.create({ data: { jobId: job.id, slotId: slot.id, workerId: worker.id, status: 'completed', agreedRatePkr: 1000 } });
    await prisma.review.create({ data: { assignmentId: asg.id, authorId: employer.id, subjectId: worker.id, direction: 'employer_on_worker', rating: 1, visibleAt: null } });

    const r = await reputationService.recomputeForUser(worker.id);
    if (!r.ok) throw new Error();
    // No visible reviews → score is exactly the prior mean.
    expect(r.value.ratingBayesian).toBe(PRIOR_MEAN);
  });
});

describe('reputation — multi-signal + trust (§7.4)', () => {
  it('computes jobs_completed, no_show_count, completion_rate from assignments', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    const employer = await makeUser({ role: 'employer' });
    const loc = await prisma.location.create({ data: { label: 'l', district: 'Swat', tehsil: 'B', lat: 34.7, lng: 72.3, precision: 'pin' } });
    async function asg(status: string) {
      const job = await prisma.job.create({ data: { employerId: employer.id, title: 't', locationId: loc.id, headcount: 1, ratePkr: 1000, rateUnit: 'day', status: 'completed', paymentMode: 'cash' } });
      const slot = await prisma.jobSlot.create({ data: { jobId: job.id, slotIndex: 1, status: 'completed' } });
      await prisma.assignment.create({ data: { jobId: job.id, slotId: slot.id, workerId: worker.id, status, agreedRatePkr: 1000 } });
    }
    await asg('completed');
    await asg('completed');
    await asg('completed');
    await asg('no_show'); // 3 completed of 4 accountable → 0.75

    await reputationService.recomputeForUser(worker.id);
    const wp = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    expect(wp.jobsCompleted).toBe(3);
    expect(wp.noShowCount).toBe(1);
    expect(Number(wp.completionRate)).toBeCloseTo(0.75, 2);
  });

  it('trust_score rises with KYC + history and is dragged down by fraud signals', async () => {
    const clean = await makeUser({ role: 'worker', kyc: 3 });
    const r1 = await reputationService.recomputeForUser(clean.id);
    if (!r1.ok) throw new Error();
    expect(r1.value.trustScore).toBeGreaterThanOrEqual(60); // kyc 3 → 60 base

    const flagged = await makeUser({ role: 'worker', kyc: 1 });
    await prisma.fraudSignal.create({ data: { userId: flagged.id, signal: 'report:scam', weight: 60 } });
    const r2 = await reputationService.recomputeForUser(flagged.id);
    if (!r2.ok) throw new Error();
    expect(r2.value.trustScore).toBeLessThan(r1.value.trustScore);
  });

  it('recompute is idempotent — same inputs, same outputs', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    const employer = await makeUser({ role: 'employer' });
    await makeVisibleReview(worker.id, employer.id, 4);
    const a = await reputationService.recomputeForUser(worker.id);
    const b = await reputationService.recomputeForUser(worker.id);
    if (!a.ok || !b.ok) throw new Error();
    expect(b.value.ratingBayesian).toBe(a.value.ratingBayesian);
    expect(b.value.trustScore).toBe(a.value.trustScore);
  });
});

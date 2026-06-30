// §6.1 / §21.2 featured-post monetization tests. Real Postgres + PostGIS.
//
// Invariants:
//  1. Featuring debits the employer wallet by the fee and credits platform_revenue,
//     and stamps featured_until 24h out.
//  2. An employer who can't cover the fee is refused (CONFLICT) and NOT charged.
//  3. Only the owner can feature; only an open job; no double-charge while featured.
//  4. A currently-featured job gets the §8 boost and outranks an equal un-featured one.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { matchingService } from '../matching.service';
import { monetizationService } from '../monetization.service';
import {
  cleanupTestData,
  ensureMasonrySpecialty,
  makeLocation,
  makeUser,
  newKey,
} from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const FEE_MINOR = 15_000n; // 150 PKR default

/** Give an employer a user wallet with a starting balance (paisa). */
async function fundWallet(userId: string, balanceMinor: bigint) {
  await prisma.wallet.create({
    data: { userId, kind: 'user', currency: 'PKR', balanceMinor },
  });
}

async function postOpenJob(employerId: string, point = { lat: 34.78, lng: 72.36 }, specialtyId?: string) {
  const loc = await makeLocation({ lat: point.lat, lng: point.lng });
  // specialty_ids requires >=1 (schema); default to masonry when the caller doesn't care.
  const sid = specialtyId ?? (await ensureMasonrySpecialty()).id;
  const created = await jobService.createJob({
    employerId,
    input: {
      title: 'mason needed',
      location_id: loc.id,
      headcount: 1,
      rate_pkr: 3000,
      rate_unit: 'day',
      specialty_ids: [sid],
      idempotency_key: newKey(),
      payment_mode: 'cash',
    },
  });
  if (!created.ok) throw new Error('createJob failed');
  return created.value.jobId;
}

describe('featured post — charging', () => {
  it('debits the employer and credits platform_revenue, stamping featured_until', async () => {
    const employer = await makeUser({ role: 'employer' });
    await fundWallet(employer.id, 50_000n); // 500 PKR
    const jobId = await postOpenJob(employer.id);

    const res = await monetizationService.featureJob({ jobId, employerId: employer.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.chargedMinor).toBe(FEE_MINOR.toString());

    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id, kind: 'user' } });
    const platform = await prisma.wallet.findFirstOrThrow({ where: { kind: 'platform_revenue' } });
    expect(empW.balanceMinor).toBe(50_000n - FEE_MINOR);
    expect(platform.balanceMinor).toBe(FEE_MINOR);

    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.featuredUntil).not.toBeNull();
    expect(job.featuredUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses an employer who cannot cover the fee, without charging', async () => {
    const employer = await makeUser({ role: 'employer' });
    await fundWallet(employer.id, 10_000n); // 100 PKR < 150 PKR fee
    const jobId = await postOpenJob(employer.id);

    const res = await monetizationService.featureJob({ jobId, employerId: employer.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('CONFLICT');

    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id, kind: 'user' } });
    expect(empW.balanceMinor).toBe(10_000n); // untouched
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.featuredUntil).toBeNull();
  });
});

describe('featured post — authorization & double-charge guards', () => {
  it("refuses to feature someone else's job", async () => {
    const owner = await makeUser({ role: 'employer' });
    const stranger = await makeUser({ role: 'employer' });
    await fundWallet(stranger.id, 50_000n);
    const jobId = await postOpenJob(owner.id);

    const res = await monetizationService.featureJob({ jobId, employerId: stranger.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('FORBIDDEN');
  });

  it('does not double-charge a job that is already featured', async () => {
    const employer = await makeUser({ role: 'employer' });
    await fundWallet(employer.id, 100_000n);
    const jobId = await postOpenJob(employer.id);

    const first = await monetizationService.featureJob({ jobId, employerId: employer.id });
    expect(first.ok).toBe(true);
    const second = await monetizationService.featureJob({ jobId, employerId: employer.id });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('CONFLICT');

    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id, kind: 'user' } });
    expect(empW.balanceMinor).toBe(100_000n - FEE_MINOR); // charged exactly once
  });
});

describe('featured post — feed boost (§8)', () => {
  it('a featured job outranks an equal un-featured job at the same distance', async () => {
    const spec = await ensureMasonrySpecialty();
    const employer = await makeUser({ role: 'employer' });
    await fundWallet(employer.id, 50_000n);

    // Worker at home with the matching specialty.
    const worker = await makeUser({ role: 'worker' });
    const home = await makeLocation({ lat: 34.78, lng: 72.36, label: 'home' });
    await prisma.workerProfile.update({ where: { userId: worker.id }, data: { baseLocationId: home.id } });
    await prisma.workerSpecialty.create({ data: { userId: worker.id, specialtyId: spec.id } });

    // Two identical jobs at the same spot; feature exactly one.
    const plainJob = await postOpenJob(employer.id, { lat: 34.781, lng: 72.36 }, spec.id);
    const boostedJob = await postOpenJob(employer.id, { lat: 34.781, lng: 72.36 }, spec.id);
    const feat = await monetizationService.featureJob({ jobId: boostedJob, employerId: employer.id });
    expect(feat.ok).toBe(true);

    const ranked = await matchingService.rankedJobsForWorker({ workerId: worker.id });
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    const ids = ranked.value.jobs.map((j) => j.jobId);
    expect(ids.indexOf(boostedJob)).toBeLessThan(ids.indexOf(plainJob));
    const boostedRow = ranked.value.jobs.find((j) => j.jobId === boostedJob);
    expect(boostedRow?.featured).toBe(true);
    expect(boostedRow?.why.featuredBoost).toBeGreaterThan(0);
  });
});

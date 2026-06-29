// §8 matching/ranking integration tests. Real Postgres + PostGIS.
//
// Invariants:
//  1. A nearer job ranks above an identical farther job (distance decay works).
//  2. A specialty-matching job outranks a non-matching one at equal distance.
//  3. Jobs the worker already applied to are excluded from the feed.
//  4. A worker with no base location gets located:false (caller falls back).
//  5. Zero nearby jobs → located:true with an empty list + a search.zero_results event.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { matchingService } from '../matching.service';
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

// Mingora, Swat — the worker's home point.
const HOME = { lat: 34.7800, lng: 72.3600 };

async function makeWorkerAt(point: { lat: number; lng: number }, specialtyId?: string) {
  const worker = await makeUser({ role: 'worker', kyc: 1 });
  const loc = await makeLocation({ lat: point.lat, lng: point.lng, label: 'home' });
  await prisma.workerProfile.update({
    where: { userId: worker.id },
    data: { baseLocationId: loc.id },
  });
  if (specialtyId) {
    await prisma.workerSpecialty.create({ data: { userId: worker.id, specialtyId } });
  }
  return worker;
}

async function postJobAt(
  employerId: string,
  point: { lat: number; lng: number },
  opts: { title: string; specialtyId: string },
) {
  const loc = await makeLocation({ lat: point.lat, lng: point.lng, label: opts.title });
  const created = await jobService.createJob({
    employerId,
    input: {
      title: opts.title,
      location_id: loc.id,
      headcount: 1,
      rate_pkr: 3000,
      rate_unit: 'day',
      specialty_ids: [opts.specialtyId],
      idempotency_key: newKey(),
      payment_mode: 'cash',
    },
  });
  if (!created.ok) throw new Error('createJob failed');
  return created.value.jobId;
}

// ~0.01° lat ≈ 1.1km; ~0.1° ≈ 11km. Used to place near vs far jobs.
const NEAR = { lat: HOME.lat + 0.01, lng: HOME.lng };
const FAR = { lat: HOME.lat + 0.12, lng: HOME.lng };

describe('matching — geo proximity ranking (§8)', () => {
  it('ranks a nearer job above an identical farther job', async () => {
    const spec = await ensureMasonrySpecialty();
    const worker = await makeWorkerAt(HOME, spec.id);
    const employer = await makeUser({ role: 'employer' });

    const farId = await postJobAt(employer.id, FAR, { title: 'far job', specialtyId: spec.id });
    const nearId = await postJobAt(employer.id, NEAR, { title: 'near job', specialtyId: spec.id });

    const r = await matchingService.rankedJobsForWorker({ workerId: worker.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.located).toBe(true);
      const ids = r.value.jobs.map((j) => j.jobId);
      expect(ids.indexOf(nearId)).toBeLessThan(ids.indexOf(farId));
      // Nearer job has a higher distance score.
      const near = r.value.jobs.find((j) => j.jobId === nearId)!;
      const far = r.value.jobs.find((j) => j.jobId === farId)!;
      expect(near.why.distanceScore).toBeGreaterThan(far.why.distanceScore);
      expect(near.distanceM).toBeLessThan(far.distanceM);
    }
  });

  it('a specialty match outranks a non-match at the same location', async () => {
    const mason = await ensureMasonrySpecialty();
    const plumber = await prisma.specialty.upsert({
      where: { slug: 'plumbing' },
      create: { slug: 'plumbing', nameEn: 'Plumber', nameUr: 'پلمبر', namePs: 'پلمبر', icon: 'pipe' },
      update: {},
    });
    const worker = await makeWorkerAt(HOME, mason.id); // worker is a mason
    const employer = await makeUser({ role: 'employer' });

    // Two jobs at the SAME point: one mason (match), one plumber (no match).
    const matchId = await postJobAt(employer.id, NEAR, { title: 'mason job', specialtyId: mason.id });
    const noMatchId = await postJobAt(employer.id, NEAR, { title: 'plumber job', specialtyId: plumber.id });

    const r = await matchingService.rankedJobsForWorker({ workerId: worker.id });
    if (!r.ok) throw new Error();
    const ids = r.value.jobs.map((j) => j.jobId);
    expect(ids.indexOf(matchId)).toBeLessThan(ids.indexOf(noMatchId));
    const match = r.value.jobs.find((j) => j.jobId === matchId)!;
    expect(match.why.specialtyMatch).toBe(1);
  });

  it('excludes jobs the worker already applied to', async () => {
    const spec = await ensureMasonrySpecialty();
    const worker = await makeWorkerAt(HOME, spec.id);
    const employer = await makeUser({ role: 'employer' });
    const jobId = await postJobAt(employer.id, NEAR, { title: 'applied job', specialtyId: spec.id });

    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    expect(applied.ok).toBe(true);

    const r = await matchingService.rankedJobsForWorker({ workerId: worker.id });
    if (!r.ok) throw new Error();
    expect(r.value.jobs.map((j) => j.jobId)).not.toContain(jobId);
  });

  it('a worker with no base location returns located:false', async () => {
    const worker = await makeUser({ role: 'worker' }); // no baseLocationId set
    const r = await matchingService.rankedJobsForWorker({ workerId: worker.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.located).toBe(false);
      expect(r.value.jobs).toEqual([]);
    }
  });

  it('zero nearby jobs → located:true, empty list, and a zero-results event', async () => {
    const worker = await makeWorkerAt(HOME);
    const r = await matchingService.rankedJobsForWorker({ workerId: worker.id });
    if (!r.ok) throw new Error();
    expect(r.value.located).toBe(true);
    expect(r.value.jobs).toEqual([]);

    const ev = await prisma.event.findFirst({
      where: { eventType: 'search.zero_results', actorId: worker.id },
    });
    expect(ev).not.toBeNull();
  });
});

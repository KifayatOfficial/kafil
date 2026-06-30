// §26/M27 rate-insights tests. Real Postgres for the service; pure for percentile math.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { rateInsightsService, __rateInsightsInternals } from '../rate-insights.service';
import { jobService } from '../job.service';
import {
  cleanupTestData,
  ensureMasonrySpecialty,
  makeLocation,
  makeUser,
  newKey,
} from '../../__tests__/test-db';

const { percentile, MIN_SAMPLE } = __rateInsightsInternals;

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

async function postJobAtRate(employerId: string, specialtyId: string, ratePkr: number) {
  const loc = await makeLocation();
  const r = await jobService.createJob({
    employerId,
    input: {
      title: 'rate sample', location_id: loc.id, headcount: 1, rate_pkr: ratePkr,
      rate_unit: 'day', specialty_ids: [specialtyId], idempotency_key: newKey(), payment_mode: 'cash',
    },
  });
  if (!r.ok) throw new Error('createJob failed');
}

describe('percentile math', () => {
  it('interpolates between ranks and hits exact endpoints', () => {
    const s = [1000, 2000, 3000, 4000, 5000];
    expect(percentile(s, 0)).toBe(1000);
    expect(percentile(s, 1)).toBe(5000);
    expect(percentile(s, 0.5)).toBe(3000);
    expect(percentile(s, 0.25)).toBe(2000);
    expect(percentile(s, 0.75)).toBe(4000);
  });
});

describe('rateInsightsService.forSpecialty', () => {
  it('returns hasData:false below the minimum sample', async () => {
    const spec = await ensureMasonrySpecialty();
    const emp = await makeUser({ role: 'employer' });
    // Post fewer than MIN_SAMPLE jobs.
    for (let i = 0; i < MIN_SAMPLE - 1; i++) await postJobAtRate(emp.id, spec.id, 3000);

    const r = await rateInsightsService.forSpecialty(spec.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hasData).toBe(false);
      expect(r.value.median).toBeNull();
    }
  });

  it('computes a band once enough recent jobs exist', async () => {
    const spec = await ensureMasonrySpecialty();
    const emp = await makeUser({ role: 'employer' });
    for (const rate of [2000, 3000, 4000, 5000, 6000]) await postJobAtRate(emp.id, spec.id, rate);

    const r = await rateInsightsService.forSpecialty(spec.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hasData).toBe(true);
      expect(r.value.sampleSize).toBe(5);
      expect(r.value.median).toBe(4000);
      expect(r.value.p25).toBe(3000);
      expect(r.value.p75).toBe(5000);
    }
  });
});

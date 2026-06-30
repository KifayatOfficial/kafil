// Integration test for keyset-paginated job feed (§P1.4). Real Postgres.
//
// Invariants:
// 1. Walking pages via nextCursor visits every open job exactly once, no dupes.
// 2. Order is newest-first (createdAt DESC, id DESC tiebreak).
// 3. nextCursor is null on the final page.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { cleanupTestData, ensureMasonrySpecialty, makeLocation, makeUser, newKey } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

async function seedOpenJobs(n: number) {
  const employer = await makeUser({ role: 'employer' });
  const specialty = await ensureMasonrySpecialty();
  const specialtyId = specialty.id;
  const loc = await makeLocation({ label: 'Mingora' });
  for (let i = 0; i < n; i++) {
    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: `Job ${i}`,
        location_id: loc.id,
        headcount: 1,
        rate_pkr: 3000 + i,
        rate_unit: 'day',
        specialty_ids: [specialtyId],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error('createJob failed');
  }
}

describe('job feed pagination', () => {
  it('walks every open job exactly once across pages', async () => {
    await seedOpenJobs(7);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await jobService.listOpen({ cursor, limit: 3 });
      if (!res.ok) throw new Error('listOpen failed');
      seen.push(...res.value.items.map((j) => j.id));
      cursor = res.value.nextCursor;
      pages += 1;
      if (pages > 10) throw new Error('pagination did not terminate'); // safety
    } while (cursor);

    expect(seen).toHaveLength(7); // all jobs
    expect(new Set(seen).size).toBe(7); // no duplicates
    expect(pages).toBe(3); // 3 + 3 + 1
  });

  it('returns newest-first and a null cursor when the feed fits one page', async () => {
    await seedOpenJobs(2);
    const res = await jobService.listOpen({ cursor: null, limit: 20 });
    if (!res.ok) throw new Error('listOpen failed');
    expect(res.value.items).toHaveLength(2);
    expect(res.value.nextCursor).toBeNull();
    // newest first: Job 1 was created after Job 0.
    expect(res.value.items[0]!.title).toBe('Job 1');
    expect(res.value.items[1]!.title).toBe('Job 0');
  });
});

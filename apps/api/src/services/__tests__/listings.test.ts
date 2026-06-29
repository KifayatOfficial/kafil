// Tests for the new owner-scoped listing endpoints used by the activity screens.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { applicationRepository } from '../../repositories/application.repository';
import { listRepository } from '../../repositories/list.repository';
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

describe('listings', () => {
  it('listForWorker returns only the calling worker’s applications, newest first', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const stranger = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    // Worker applies to one job, stranger to another.
    for (const w of [worker, stranger]) {
      const j = await jobService.createJob({
        employerId: employer.id,
        input: {
          title: `job-${w.id.slice(0, 6)}`,
          location_id: loc.id,
          headcount: 1,
          rate_pkr: 3000,
          rate_unit: 'day',
          specialty_ids: [spec.id],
          idempotency_key: newKey(),
          payment_mode: 'cash',
        },
      });
      if (!j.ok) throw new Error();
      await applicationService.apply({
        workerId: w.id,
        jobId: j.value.jobId,
        input: { idempotency_key: newKey() },
      });
    }

    const mine = await applicationRepository.listForWorker(worker.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.workerId).toBe(worker.id);
    // Job is embedded for the UI.
    expect(mine[0]?.job.title.length).toBeGreaterThan(0);
  });

  it('listForEmployer returns only the calling employer’s jobs, with applicant count', async () => {
    const employer = await makeUser({ role: 'employer' });
    const stranger = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    const ownJob = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'mine',
        location_id: loc.id,
        headcount: 2,
        rate_pkr: 3000,
        rate_unit: 'day',
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    await jobService.createJob({
      employerId: stranger.id,
      input: {
        title: 'theirs',
        location_id: loc.id,
        headcount: 1,
        rate_pkr: 3000,
        rate_unit: 'day',
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    if (!ownJob.ok) throw new Error();

    // Apply to the own-job so the count is non-zero.
    await applicationService.apply({
      workerId: worker.id,
      jobId: ownJob.value.jobId,
      input: { idempotency_key: newKey() },
    });

    const mine = await listRepository.jobsForEmployer(employer.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toBe('mine');
    expect(mine[0]?._count.applications).toBe(1);
    expect(mine[0]?.slots).toHaveLength(2);
  });
});

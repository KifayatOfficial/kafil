// §7 — double-blind review tests.
//
// Invariants tested:
// 1. Reviews are HIDDEN (visible_at = null) until BOTH parties submit.
// 2. When the second party submits, BOTH reviews flip to visible in one txn.
// 3. The service refuses self-review.
// 4. Submitting twice from the same author returns CONFLICT (or idempotent existing).
// 5. Reviews are only accepted when the assignment is in a reviewable status
//    (completed / in_review_window / finalized).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { reviewService } from '../review.service';
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

async function buildCompletedAssignment() {
  const employer = await makeUser({ role: 'employer' });
  const worker = await makeUser({ role: 'worker' });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();

  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'review-test',
      location_id: loc.id,
      headcount: 1,
      rate_pkr: 4000,
      rate_unit: 'day',
      specialty_ids: [spec.id],
      idempotency_key: newKey(),
      payment_mode: 'cash',
    },
  });
  if (!created.ok) throw new Error('createJob failed');

  const applied = await applicationService.apply({
    workerId: worker.id,
    jobId: created.value.jobId,
    input: { idempotency_key: newKey() },
  });
  if (!applied.ok) throw new Error('apply failed');

  const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId: created.value.jobId } });
  const accepted = await assignmentService.acceptApplication({
    employerId: employer.id,
    applicationId: applied.value.applicationId,
    input: {
      slot_id: slot.id,
      expected_slot_version: slot.version,
      idempotency_key: newKey(),
    },
  });
  if (!accepted.ok) throw new Error('accept failed');

  // System → in_progress, then both mark done → completed (auto-rollforward).
  await prisma.assignment.update({
    where: { id: accepted.value.assignmentId },
    data: { status: 'in_progress', startedAt: new Date(), version: { increment: 1 } },
  });
  await assignmentService.transition({
    assignmentId: accepted.value.assignmentId,
    name: 'worker_mark_done',
    actorId: worker.id,
    by: 'worker',
  });
  await assignmentService.transition({
    assignmentId: accepted.value.assignmentId,
    name: 'employer_mark_done',
    actorId: employer.id,
    by: 'employer',
  });

  return { employer, worker, assignmentId: accepted.value.assignmentId };
}

describe('§7 reviews — double-blind reveal', () => {
  it('first submission is hidden; second submission reveals both atomically', async () => {
    const { employer, worker, assignmentId } = await buildCompletedAssignment();

    // Worker reviews employer first.
    const w = await reviewService.submit({
      actorId: worker.id,
      assignmentId,
      input: { rating: 5, comment: 'great employer', idempotency_key: newKey() },
    });
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.value.visible).toBe(false);

    // Public list (visible-only) returns 0.
    const hiddenView = await reviewService.listForAssignment(assignmentId);
    expect(hiddenView.ok).toBe(true);
    if (hiddenView.ok) expect(hiddenView.value).toHaveLength(0);

    // Now employer reviews worker — both flip to visible.
    const e = await reviewService.submit({
      actorId: employer.id,
      assignmentId,
      input: { rating: 4, comment: 'solid work', idempotency_key: newKey() },
    });
    expect(e.ok).toBe(true);
    if (e.ok) expect(e.value.visible).toBe(true);

    const finalView = await reviewService.listForAssignment(assignmentId);
    expect(finalView.ok).toBe(true);
    if (finalView.ok) {
      expect(finalView.value).toHaveLength(2);
      for (const r of finalView.value) expect(r.visibleAt).not.toBeNull();
    }

    // Event spine includes review.both_visible.
    const events = await prisma.event.findMany({
      where: { OR: [{ refId: assignmentId }, { refType: 'review' }] },
      orderBy: { id: 'asc' },
      select: { eventType: true },
    });
    expect(events.map((x) => x.eventType)).toContain('review.both_visible');
  });

  it('rejects self-review (FORBIDDEN before hitting the DB CHECK)', async () => {
    const { worker, assignmentId } = await buildCompletedAssignment();
    // The service derives subjectId from the assignment's counterparty — but the
    // CHECK constraint is the durable enforcement. Here we simulate an attempt by
    // an unrelated user (which the service treats as FORBIDDEN). Self-review is
    // *also* structurally impossible because subjectId is derived, not supplied.
    const stranger = await makeUser({ role: 'worker' });
    const res = await reviewService.submit({
      actorId: stranger.id,
      assignmentId,
      input: { rating: 5, idempotency_key: newKey() },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('FORBIDDEN');

    // And the same author submitting twice is idempotent (returns existing).
    const first = await reviewService.submit({
      actorId: worker.id,
      assignmentId,
      input: { rating: 5, idempotency_key: newKey() },
    });
    if (!first.ok) throw new Error('first submit failed');
    const second = await reviewService.submit({
      actorId: worker.id,
      assignmentId,
      input: { rating: 1, idempotency_key: newKey() },
    });
    if (!second.ok) throw new Error('idempotent second-submit should succeed');
    expect(second.value.reviewId).toBe(first.value.reviewId);
  });

  it('refuses submission when assignment is not in a reviewable status', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();
    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'not-yet-done',
        location_id: loc.id,
        headcount: 1,
        rate_pkr: 4000,
        rate_unit: 'day',
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error();
    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId: created.value.jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId: created.value.jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    if (!accepted.ok) throw new Error();

    // Assignment is in `assigned` — pre-completion. Review must be refused.
    const r = await reviewService.submit({
      actorId: worker.id,
      assignmentId: accepted.value.assignmentId,
      input: { rating: 5, idempotency_key: newKey() },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFLICT');
  });
});

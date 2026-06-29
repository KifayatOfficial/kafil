// Integration tests for the Tier-A/Tier-B invariants. These prove the §24/§26
// fixes don't regress as we add features (reviews, chat, etc.).
//
// Tests hit the real local Postgres via @kafil/api services — not the HTTP layer —
// because the goal is to verify business-logic invariants (state machine, optimistic
// locking, partial-unique indexes, ledger), not HTTP routing.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
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

describe('core loop — apply → accept → mark-done → completed', () => {
  it('happy path: 1-slot job ends in `completed` with both timestamps and events', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    // Post a 1-headcount job.
    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'IT-1 job',
        location_id: loc.id,
        headcount: 1,
        rate_pkr: 4000,
        rate_unit: 'day',
        duration_days: 2,
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jobId = created.value.jobId;

    // Worker applies.
    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { proposed_rate_pkr: 4000, idempotency_key: newKey() },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    // Employer accepts.
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const assignmentId = accepted.value.assignmentId;

    // System advances to in_progress (start_date reached).
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: 'in_progress', startedAt: new Date(), version: { increment: 1 } },
    });

    // Worker marks done.
    const wDone = await assignmentService.transition({
      assignmentId,
      name: 'worker_mark_done',
      actorId: worker.id,
      by: 'worker',
    });
    expect(wDone.ok).toBe(true);
    if (wDone.ok) expect(wDone.value.status).toBe('awaiting_employer_confirm');

    // Employer marks done — auto-rollforward to `completed` in same txn.
    const eDone = await assignmentService.transition({
      assignmentId,
      name: 'employer_mark_done',
      actorId: employer.id,
      by: 'employer',
    });
    expect(eDone.ok).toBe(true);
    if (eDone.ok) expect(eDone.value.status).toBe('completed');

    // Final DB state.
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('completed');
    expect(a.workerMarkedDoneAt).not.toBeNull();
    expect(a.employerMarkedDoneAt).not.toBeNull();
    expect(a.completedAt).not.toBeNull();

    // Bug-fix verification (this round): the SLOT flipped to completed, and
    // because this is a 1-slot job, the JOB also reached completed via the
    // recompute helper — in the same txn as the assignment's auto-rollforward.
    const finalSlot = await prisma.jobSlot.findUniqueOrThrow({ where: { id: a.slotId } });
    expect(finalSlot.status).toBe('completed');
    const finalJob = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(finalJob.status).toBe('completed');

    // Event spine — order matters.
    const events = await prisma.event.findMany({
      where: { refId: assignmentId },
      orderBy: { id: 'asc' },
      select: { eventType: true },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'application.accepted',
      'assignment.worker_mark_done',
      'assignment.employer_mark_done',
      'assignment.both_done_to_completed',
    ]);
  });
});

describe('§24/A4 — optimistic lock on slot fill', () => {
  it('rejects accept when slot version has moved (concurrent accept wins)', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker1 = await makeUser({ role: 'worker' });
    const worker2 = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'race-test',
        location_id: loc.id,
        headcount: 1,
        rate_pkr: 3000,
        rate_unit: 'day',
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error('createJob failed');
    const jobId = created.value.jobId;

    // Both workers apply.
    const a1 = await applicationService.apply({
      workerId: worker1.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    const a2 = await applicationService.apply({
      workerId: worker2.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!a1.ok || !a2.ok) throw new Error('apply failed');

    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const ver = slot.version;

    // Employer accepts worker1 — succeeds.
    const ok1 = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: a1.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: ver,
        idempotency_key: newKey(),
      },
    });
    expect(ok1.ok).toBe(true);

    // Employer attempts to accept worker2 with the now-stale version — must fail with CONFLICT.
    const ok2 = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: a2.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: ver, // stale!
        idempotency_key: newKey(),
      },
    });
    expect(ok2.ok).toBe(false);
    if (!ok2.ok) expect(ok2.code).toBe('CONFLICT');

    // DB invariants: still only one assignment, slot still filled by worker1.
    const assignmentCount = await prisma.assignment.count({ where: { slotId: slot.id } });
    expect(assignmentCount).toBe(1);
    const slotAfter = await prisma.jobSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(slotAfter.status).toBe('filled');
    expect(slotAfter.assignedWorkerId).toBe(worker1.id);
  });
});

describe('§24/A5 — partial-unique on applications allows re-apply after rejection', () => {
  it('rejects a duplicate while pending, then allows a fresh apply after rejection', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 're-apply test',
        location_id: loc.id,
        headcount: 1,
        rate_pkr: 2500,
        rate_unit: 'day',
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error('createJob failed');
    const jobId = created.value.jobId;

    // First apply succeeds.
    const a1 = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    expect(a1.ok).toBe(true);

    // Second apply while pending → CONFLICT (active already exists).
    const a2 = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    expect(a2.ok).toBe(false);
    if (!a2.ok) expect(a2.code).toBe('CONFLICT');

    // Reject the first application (terminal state).
    if (a1.ok) {
      await prisma.application.update({
        where: { id: a1.value.applicationId },
        data: { status: 'rejected', decidedAt: new Date() },
      });
    }

    // Now re-apply — should succeed (partial-unique releases on terminal status).
    const a3 = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    expect(a3.ok).toBe(true);
  });
});

describe('§24/A3 — multi-headcount jobs fill independently and job state recomputes', () => {
  it('fills 2 slots in two accepts; job goes open → filled at the right moment', async () => {
    const employer = await makeUser({ role: 'employer' });
    const w1 = await makeUser({ role: 'worker' });
    const w2 = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: '2-slot job',
        location_id: loc.id,
        headcount: 2,
        rate_pkr: 4000,
        rate_unit: 'day',
        specialty_ids: [spec.id],
        idempotency_key: newKey(),
        payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error('createJob failed');
    const jobId = created.value.jobId;

    const slots = await prisma.jobSlot.findMany({ where: { jobId }, orderBy: { slotIndex: 'asc' } });
    expect(slots).toHaveLength(2);

    const a1 = await applicationService.apply({
      workerId: w1.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    const a2 = await applicationService.apply({
      workerId: w2.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!a1.ok || !a2.ok) throw new Error('apply failed');

    const slot0 = slots[0]!;
    const slot1 = slots[1]!;

    // Fill slot 1 — job should still be `open` (1 open slot remaining).
    await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: a1.value.applicationId,
      input: {
        slot_id: slot0.id,
        expected_slot_version: slot0.version,
        idempotency_key: newKey(),
      },
    });
    const j1 = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(j1.status).toBe('open');

    // Fill slot 2 — job → `filled`.
    await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: a2.value.applicationId,
      input: {
        slot_id: slot1.id,
        expected_slot_version: slot1.version,
        idempotency_key: newKey(),
      },
    });
    const j2 = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(j2.status).toBe('filled');
  });
});

describe('§26/M1 — silence does NOT auto-complete (deprecated A6 absent)', () => {
  it('the state machine offers `silence_route_to_ops_review` and NO directional auto-complete', async () => {
    // This is a contract test on packages/core's state machine.
    const { transitions, canTransition } = await import('@kafil/core');

    const names = transitions.map((t) => t.name);
    expect(names).toContain('silence_route_to_ops_review');
    // The deprecated §24/A6 directional fallback must not exist.
    expect(names).not.toContain('auto_complete_employer_favor');
    expect(names).not.toContain('auto_complete_worker_favor');

    // Silence from awaiting_employer_confirm routes ONLY by 'system' to awaiting_ops_review.
    expect(
      canTransition('awaiting_employer_confirm', 'silence_route_to_ops_review', 'system'),
    ).toBe(true);
    expect(
      canTransition('awaiting_employer_confirm', 'silence_route_to_ops_review', 'worker'),
    ).toBe(false);
    expect(
      canTransition('awaiting_employer_confirm', 'silence_route_to_ops_review', 'employer'),
    ).toBe(false);
  });
});

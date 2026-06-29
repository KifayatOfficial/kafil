// §4/§18 dispute opening + evidence integration tests. Real Postgres.
//
// Invariants:
//  1. A party (worker or employer) opens a dispute → assignment → 'disputed', a Dispute
//     row exists, a dispute.opened event fires, and the workbench picks it up.
//  2. A non-party cannot open a dispute (FORBIDDEN).
//  3. Re-opening is idempotent — one open dispute per assignment.
//  4. A party adds evidence; a non-party cannot.
//  5. Past the 7-day window (post-finalize) opening is rejected (file a report instead).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { disputeService } from '../dispute.service';
import { workbenchService } from '../workbench.service';
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

async function acceptedAssignment() {
  const employer = await makeUser({ role: 'employer' });
  const worker = await makeUser({ role: 'worker' });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();
  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'dispute-test',
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
    input: { slot_id: slot.id, expected_slot_version: slot.version, idempotency_key: newKey() },
  });
  if (!accepted.ok) throw new Error('accept failed');
  return { employer, worker, assignmentId: accepted.value.assignmentId };
}

describe('disputes — opening (§4/§18)', () => {
  it('a party opens a dispute → assignment disputed + event + workbench picks it up', async () => {
    const { worker, assignmentId } = await acceptedAssignment();

    const r = await disputeService.openDispute({
      actorId: worker.id,
      assignmentId,
      input: { category: 'not_done', detail: 'employer never showed', idempotency_key: newKey() },
    });
    expect(r.ok).toBe(true);

    const asg = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(asg.status).toBe('disputed');

    const ev = await prisma.event.findFirst({ where: { eventType: 'dispute.opened', refType: 'dispute' } });
    expect(ev).not.toBeNull();

    // The §18 workbench queue includes this dispute.
    const queue = await workbenchService.listQueue();
    if (!queue.ok) throw new Error();
    expect(queue.value.some((i) => i.source === 'dispute' && i.assignmentId === assignmentId)).toBe(true);
  });

  it('a non-party cannot open a dispute (FORBIDDEN)', async () => {
    const { assignmentId } = await acceptedAssignment();
    const stranger = await makeUser({ role: 'worker' });
    const r = await disputeService.openDispute({
      actorId: stranger.id,
      assignmentId,
      input: { category: 'quality', idempotency_key: newKey() },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN');
    const asg = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(asg.status).not.toBe('disputed');
  });

  it('re-opening is idempotent — one open dispute per assignment', async () => {
    const { employer, assignmentId } = await acceptedAssignment();
    const first = await disputeService.openDispute({
      actorId: employer.id,
      assignmentId,
      input: { category: 'quality', idempotency_key: newKey() },
    });
    const second = await disputeService.openDispute({
      actorId: employer.id,
      assignmentId,
      input: { category: 'quality', idempotency_key: newKey() },
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.disputeId).toBe(first.value.disputeId);
    expect(await prisma.dispute.count({ where: { assignmentId } })).toBe(1);
  });

  it('rejects opening past the 7-day post-finalize window (file a report instead)', async () => {
    const { worker, assignmentId } = await acceptedAssignment();
    // Force the assignment finalized 8 days ago.
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: 'finalized', finalizedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const r = await disputeService.openDispute({
      actorId: worker.id,
      assignmentId,
      input: { category: 'quality', idempotency_key: newKey() },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFLICT');
  });
});

describe('disputes — evidence (§2.10)', () => {
  it('a party adds evidence; a non-party cannot', async () => {
    const { worker, employer, assignmentId } = await acceptedAssignment();
    const opened = await disputeService.openDispute({
      actorId: worker.id,
      assignmentId,
      input: { category: 'not_done', idempotency_key: newKey() },
    });
    if (!opened.ok) throw new Error();

    // Employer (the counterparty, still a party) adds evidence.
    const good = await disputeService.addEvidence({
      actorId: employer.id,
      disputeId: opened.value.disputeId,
      input: { kind: 'text', body: 'I was there at 9am, worker did not arrive', idempotency_key: newKey() },
    });
    expect(good.ok).toBe(true);

    // A stranger cannot.
    const stranger = await makeUser({ role: 'worker' });
    const bad = await disputeService.addEvidence({
      actorId: stranger.id,
      disputeId: opened.value.disputeId,
      input: { kind: 'text', body: 'nosy', idempotency_key: newKey() },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('FORBIDDEN');

    expect(await prisma.disputeEvidence.count({ where: { disputeId: opened.value.disputeId } })).toBe(1);
  });
});

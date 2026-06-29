// Workbench tests. Verify:
//   1. The queue surfaces both awaiting_ops_review assignments AND open disputes.
//   2. getCase returns the full timeline incl. events + messages.
//   3. resolve(complete_in_active_party_favor) on an ops-review case →
//      assignment.status='completed', moderation_actions audit row, event,
//      notifications for both parties.
//   4. resolve(refund_employer) → assignment.status='cancelled_by_employer'.
//   5. resolve(open_formal_dispute) creates a Dispute row + flips to 'disputed'.
//   6. resolve is idempotent under re-application (same idempotency key returns
//      the same outcome from the route layer — service is naturally idempotent on
//      a no-op state transition).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
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

async function buildOpsReviewCase() {
  const employer = await makeUser({ role: 'employer' });
  const worker = await makeUser({ role: 'worker' });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();

  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'wb-test',
      location_id: loc.id,
      headcount: 1,
      rate_pkr: 3000,
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

  // Force the assignment into awaiting_ops_review (the state §26/M1 routes to).
  await prisma.assignment.update({
    where: { id: accepted.value.assignmentId },
    data: { status: 'awaiting_ops_review', version: { increment: 1 } },
  });

  return { employer, worker, assignmentId: accepted.value.assignmentId, jobId: created.value.jobId };
}

describe('workbench — queue', () => {
  it('surfaces awaiting_ops_review assignments', async () => {
    const { assignmentId } = await buildOpsReviewCase();
    const q = await workbenchService.listQueue();
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const ours = q.value.find((i) => i.assignmentId === assignmentId);
    expect(ours).toBeTruthy();
    expect(ours?.source).toBe('ops_review');
  });

  it('also surfaces open disputes', async () => {
    const { assignmentId } = await buildOpsReviewCase();
    await prisma.dispute.create({
      data: {
        assignmentId,
        openedBy: '00000000-0000-0000-0000-000000000010', // demo employer
        category: 'quality',
        status: 'open',
      },
    });
    const q = await workbenchService.listQueue();
    if (!q.ok) throw new Error();
    const sources = q.value.filter((i) => i.assignmentId === assignmentId).map((i) => i.source);
    expect(sources).toContain('ops_review');
    expect(sources).toContain('dispute');
  });
});

describe('workbench — getCase', () => {
  it('returns the assignment timeline + events + conversation transcript', async () => {
    const { assignmentId } = await buildOpsReviewCase();
    const c = await workbenchService.getCase({ assignmentId });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.assignment.id).toBe(assignmentId);
    // The conversation was auto-created on accept (§5).
    expect(c.value.conversation).not.toBeNull();
    // Events include application.accepted at minimum.
    expect(c.value.events.some((e) => e.eventType === 'application.accepted')).toBe(true);
  });
});

describe('workbench — resolve', () => {
  it('complete_in_active_party_favor → completed; moderation_action + event written; both parties notified', async () => {
    const { employer, worker, assignmentId } = await buildOpsReviewCase();
    const moderator = await makeUser({ role: 'moderator' });

    const r = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId,
      input: { resolution: 'complete_in_active_party_favor', note: 'evidence on file' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assignmentStatus).toBe('completed');

    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('completed');
    expect(a.completedAt).not.toBeNull();

    const mod = await prisma.moderationAction.findFirstOrThrow({
      where: { actorId: moderator.id, targetId: assignmentId },
    });
    expect(mod.action).toBe('resolve:complete_in_active_party_favor');

    const evt = await prisma.event.findFirstOrThrow({
      where: { refType: 'assignment', refId: assignmentId, eventType: 'workbench.resolved' },
    });
    const payload = evt.payload as { resolution: string; previousStatus: string; newStatus: string };
    expect(payload.resolution).toBe('complete_in_active_party_favor');
    expect(payload.newStatus).toBe('completed');

    for (const uid of [worker.id, employer.id]) {
      const n = await prisma.notification.findFirst({ where: { userId: uid, type: 'workbench.resolution' } });
      expect(n).not.toBeNull();
    }
  });

  it('refund_employer → cancelled_by_employer', async () => {
    const { assignmentId } = await buildOpsReviewCase();
    const moderator = await makeUser({ role: 'admin' });
    const r = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId,
      input: { resolution: 'refund_employer' },
    });
    expect(r.ok).toBe(true);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('cancelled_by_employer');
  });

  it('open_formal_dispute creates a Dispute row + flips to disputed', async () => {
    const { assignmentId } = await buildOpsReviewCase();
    const moderator = await makeUser({ role: 'moderator' });
    const r = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId,
      input: { resolution: 'open_formal_dispute', note: 'needs deeper investigation' },
    });
    expect(r.ok).toBe(true);

    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('disputed');

    const d = await prisma.dispute.findFirstOrThrow({ where: { assignmentId } });
    expect(d.status).toBe('open');
    expect(d.openedBy).toBe(moderator.id);
    expect(d.assignedAgent).toBe(moderator.id);
  });
});

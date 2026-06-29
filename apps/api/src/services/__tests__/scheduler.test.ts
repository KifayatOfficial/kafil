// Scheduler integration tests against real Postgres.
//
// Two big behaviours to lock down:
//
// 1. assigned → expired after the confirm-timeout.
//    Slot reopens; job state recomputes back to `open`; transactional notification
//    written for the employer.
//
// 2. §26/M1 — awaiting_*_confirm silence handling.
//    a) With ≥2/3 evidence (photos + geo, photos + chat ack, etc.) →
//       assignment auto-completes with evidence trail.
//    b) With <2/3 evidence → assignment routes to `awaiting_ops_review`;
//       both parties get notified.
//
// All ticks are tested as IDEMPOTENT (re-running produces no extra writes).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { chatService } from '../chat.service';
import { schedulerService } from '../scheduler.service';
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

async function buildAssigned() {
  const employer = await makeUser({ role: 'employer' });
  const worker = await makeUser({ role: 'worker' });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();
  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'sched-test',
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
  return {
    employer,
    worker,
    jobId: created.value.jobId,
    assignmentId: accepted.value.assignmentId,
    conversationId: accepted.value.conversationId,
    slotId: slot.id,
  };
}

describe('scheduler — assigned → expired (§4.4)', () => {
  it('expires an assignment whose confirm window elapsed; slot reopens; employer notified', async () => {
    const { assignmentId, jobId, slotId, employer } = await buildAssigned();

    // Make the timeout zero so any prior accept is already "expired".
    await prisma.setting.upsert({
      where: { key: 'scheduler.confirm_timeout_ms' },
      create: { key: 'scheduler.confirm_timeout_ms', value: 0 },
      update: { value: 0 },
    });

    const stats = await schedulerService.tickOnce();
    expect(stats.expiredAssigned).toBeGreaterThanOrEqual(1);

    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('expired');

    const slot = await prisma.jobSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slot.status).toBe('open');
    expect(slot.assignedWorkerId).toBeNull();

    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('open');

    const evt = await prisma.event.findFirst({
      where: { refType: 'assignment', refId: assignmentId, eventType: 'assignment.expire_unconfirmed' },
    });
    expect(evt).not.toBeNull();

    // Employer received a transactional notification.
    const notif = await prisma.notification.findFirst({
      where: { userId: employer.id, type: 'assignment.expired' },
    });
    expect(notif).not.toBeNull();

    // Idempotent: re-running tick produces no extra expire row.
    const second = await schedulerService.tickOnce();
    expect(second.expiredAssigned).toBe(0);
  });

  it('does NOT expire fresh assignments whose timeout has not elapsed', async () => {
    const { assignmentId } = await buildAssigned();
    // Default timeout is 24h; current is way under that.
    const stats = await schedulerService.tickOnce();
    expect(stats.expiredAssigned).toBe(0);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('assigned');
  });
});

describe('scheduler — §26/M1 silence handling', () => {
  async function buildAwaitingEmployerConfirm(opts: {
    withPhotos?: boolean;
    withGeo?: boolean;
    withChatAck?: boolean;
  }) {
    const ctx = await buildAssigned();

    // Advance to in_progress (system transition; simulated for test).
    await prisma.assignment.update({
      where: { id: ctx.assignmentId },
      data: { status: 'in_progress', startedAt: new Date(), version: { increment: 1 } },
    });

    // Worker marks done with whichever evidence the test wants.
    const payload: { photo_urls?: string[]; geo?: { lat: number; lng: number; accuracy_m: number } } = {};
    if (opts.withPhotos) payload.photo_urls = ['https://example.com/a.jpg'];
    if (opts.withGeo) payload.geo = { lat: 34.78, lng: 72.36, accuracy_m: 15 };

    // Reach the service directly so the event payload includes the evidence.
    const r = await assignmentService.transition({
      assignmentId: ctx.assignmentId,
      name: 'worker_mark_done',
      actorId: ctx.worker.id,
      by: 'worker',
      payload,
    });
    if (!r.ok) throw new Error('mark_done failed');

    if (opts.withChatAck) {
      const ack = await chatService.sendMessage({
        conversationId: ctx.conversationId,
        senderId: ctx.employer.id,
        input: { body: 'Got it — paid in full.', idempotency_key: newKey() },
      });
      expect(ack.ok).toBe(true);
    }

    // Force silence-timeout=0 so the tick fires immediately.
    await prisma.setting.upsert({
      where: { key: 'scheduler.markdone_silence_timeout_ms' },
      create: { key: 'scheduler.markdone_silence_timeout_ms', value: 0 },
      update: { value: 0 },
    });

    return ctx;
  }

  it('completes with evidence when ≥2/3 signals are present (photos + geo)', async () => {
    const { assignmentId } = await buildAwaitingEmployerConfirm({
      withPhotos: true,
      withGeo: true,
    });
    const stats = await schedulerService.tickOnce();
    expect(stats.routedToOpsReview).toBe(0);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('completed');
    expect(a.completedAt).not.toBeNull();

    const evt = await prisma.event.findFirst({
      where: { refType: 'assignment', refId: assignmentId, eventType: 'assignment.silence_completed_with_evidence' },
    });
    expect(evt).not.toBeNull();
  });

  it('routes to awaiting_ops_review when <2/3 evidence (e.g. photos only)', async () => {
    const { assignmentId, worker, employer } = await buildAwaitingEmployerConfirm({
      withPhotos: true,
      // no geo, no chat ack
    });
    const stats = await schedulerService.tickOnce();
    expect(stats.routedToOpsReview).toBeGreaterThanOrEqual(1);

    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('awaiting_ops_review');

    const evt = await prisma.event.findFirst({
      where: { refType: 'assignment', refId: assignmentId, eventType: 'assignment.silence_route_to_ops_review' },
    });
    expect(evt).not.toBeNull();

    // Both parties notified (M1 requirement).
    const ne = await prisma.notification.findFirst({
      where: { userId: employer.id, type: 'assignment.in_ops_review' },
    });
    const nw = await prisma.notification.findFirst({
      where: { userId: worker.id, type: 'assignment.in_ops_review' },
    });
    expect(ne).not.toBeNull();
    expect(nw).not.toBeNull();
  });

  it('completes with evidence when photos + chat ack (≥2/3)', async () => {
    const { assignmentId } = await buildAwaitingEmployerConfirm({
      withPhotos: true,
      withChatAck: true,
    });
    await schedulerService.tickOnce();
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe('completed');
  });

  it('is idempotent — second tick after silence_route_to_ops_review is a no-op', async () => {
    await buildAwaitingEmployerConfirm({ withPhotos: true });
    const first = await schedulerService.tickOnce();
    const second = await schedulerService.tickOnce();
    expect(first.routedToOpsReview).toBeGreaterThanOrEqual(1);
    expect(second.routedToOpsReview).toBe(0);
  });
});

// §11 — notification triggers. Real Postgres. Verifies the two core liquidity-loop
// events create in-app notification rows for the right recipient:
//   apply  → employer gets "new applicant"
//   accept → worker gets "you're hired"
// Notifications are fired post-commit + non-fatal (void), so we await a short tick to
// let the fire-and-forget send() write its rows before asserting.

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

/** Let the post-commit fire-and-forget notification send() settle. */
const tick = () => new Promise((r) => setTimeout(r, 150));

async function notificationsFor(userId: string, type: string) {
  return prisma.notification.findMany({ where: { userId, type } });
}

describe('§11 notification triggers', () => {
  it('notifies the employer on a new application and the worker on accept', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();

    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'notify job', location_id: loc.id, headcount: 1, rate_pkr: 4000,
        rate_unit: 'day', specialty_ids: [spec.id], idempotency_key: newKey(), payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error('createJob failed');

    // Apply → employer notified.
    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId: created.value.jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error('apply failed');
    await tick();

    const employerNotifs = await notificationsFor(employer.id, 'application.created');
    expect(employerNotifs.length).toBe(1);
    expect(employerNotifs[0]!.refId).toBe(created.value.jobId);

    // Accept → worker notified.
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId: created.value.jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: { slot_id: slot.id, expected_slot_version: slot.version, idempotency_key: newKey() },
    });
    if (!accepted.ok) throw new Error('accept failed');
    await tick();

    const workerNotifs = await notificationsFor(worker.id, 'application.accepted');
    expect(workerNotifs.length).toBe(1);
    expect(workerNotifs[0]!.refId).toBe(accepted.value.assignmentId);

    // The worker did NOT get the employer's notification (and vice-versa).
    expect((await notificationsFor(worker.id, 'application.created')).length).toBe(0);
    expect((await notificationsFor(employer.id, 'application.accepted')).length).toBe(0);
  });

  it('delivers a push row when the recipient has a registered token', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    // Register a push token for the employer.
    await prisma.device.create({
      data: { userId: employer.id, deviceFingerprint: 'fp-1', pushToken: 'ExpoPushToken[xyz]', pushTokenStatus: 'active', lastSeenAt: new Date() },
    });
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();
    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'push job', location_id: loc.id, headcount: 1, rate_pkr: 3000,
        rate_unit: 'day', specialty_ids: [spec.id], idempotency_key: newKey(), payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error();
    const applied = await applicationService.apply({
      workerId: worker.id, jobId: created.value.jobId, input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    await tick();

    const notif = (await notificationsFor(employer.id, 'application.created'))[0]!;
    const deliveries = await prisma.notificationDelivery.findMany({ where: { notificationId: notif.id } });
    const channels = deliveries.map((d) => d.channel).sort();
    // in-app always, plus push because a token is registered.
    expect(channels).toContain('inapp');
    expect(channels).toContain('push');
    const push = deliveries.find((d) => d.channel === 'push')!;
    expect(push.status).toBe('sent'); // console provider always succeeds
  });
});

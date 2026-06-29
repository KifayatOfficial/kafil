// Integration tests for the Trust & Safety subsystem (§9–§10, P7). Real Postgres.
//
// Invariants:
//  1. reportEntity creates a Report row AND a weighted FraudSignal on the OFFENDER
//     (the user behind the target), not the reporter.
//  2. A reporter holds at most one OPEN report per target (re-report is a no-op).
//  3. Three distinct reporters auto-escalate a target (moderation_action + flag).
//  4. Reporting yourself / a missing target is rejected.
//  5. blockUser closes the chat channel in BOTH directions (F11).
//  6. F1 — a job posted with fee language raises a fee_request fraud signal on the employer.
//  7. moderateUser ban flips users.status=banned + writes a moderation_actions audit row;
//     a banned user can no longer obtain a session via verifyOtp (§9).
//  8. lift restores status to active and the user can log in again.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { chatService } from '../chat.service';
import { safetyService } from '../safety.service';
import { authService, __test_getPendingOtp } from '../auth.service';
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

async function postJob(employerId: string, overrides?: { title?: string; description?: string }) {
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();
  const created = await jobService.createJob({
    employerId,
    input: {
      title: overrides?.title ?? 'need a mason',
      description: overrides?.description,
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
  return created.value.jobId;
}

describe('reporting (§9)', () => {
  it('a report on a job creates a Report + a fee_request-weighted signal on the employer', async () => {
    const employer = await makeUser({ role: 'employer' });
    const reporter = await makeUser({ role: 'worker' });
    const jobId = await postJob(employer.id);

    const res = await safetyService.reportEntity({
      reporterId: reporter.id,
      input: {
        target_type: 'job',
        target_id: jobId,
        reason: 'fee_request',
        idempotency_key: newKey(),
      },
    });
    expect(res.ok).toBe(true);

    const report = await prisma.report.findFirstOrThrow({ where: { targetId: jobId } });
    expect(report.reporterId).toBe(reporter.id);
    expect(report.status).toBe('open');

    // Fraud signal lands on the EMPLOYER (offender), not the reporter.
    const sig = await prisma.fraudSignal.findFirstOrThrow({ where: { userId: employer.id } });
    expect(sig.signal).toBe('report:fee_request');
    expect(sig.weight).toBe(80);
    const onReporter = await prisma.fraudSignal.findFirst({ where: { userId: reporter.id } });
    expect(onReporter).toBeNull();
  });

  it('re-reporting the same target is a no-op (one open report per reporter)', async () => {
    const employer = await makeUser({ role: 'employer' });
    const reporter = await makeUser({ role: 'worker' });
    const jobId = await postJob(employer.id);

    const first = await safetyService.reportEntity({
      reporterId: reporter.id,
      input: { target_type: 'job', target_id: jobId, reason: 'scam', idempotency_key: newKey() },
    });
    const second = await safetyService.reportEntity({
      reporterId: reporter.id,
      input: { target_type: 'job', target_id: jobId, reason: 'scam', idempotency_key: newKey() },
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.reportId).toBe(first.value.reportId);

    expect(await prisma.report.count({ where: { targetId: jobId } })).toBe(1);
    expect(await prisma.fraudSignal.count({ where: { userId: employer.id } })).toBe(1);
  });

  it('three distinct reporters auto-escalate the target', async () => {
    const employer = await makeUser({ role: 'employer' });
    const jobId = await postJob(employer.id);

    let last: Awaited<ReturnType<typeof safetyService.reportEntity>> | undefined;
    for (let n = 0; n < 3; n++) {
      const reporter = await makeUser({ role: 'worker' });
      last = await safetyService.reportEntity({
        reporterId: reporter.id,
        input: { target_type: 'job', target_id: jobId, reason: 'fake', idempotency_key: newKey() },
      });
    }
    expect(last?.ok).toBe(true);
    if (last?.ok) expect(last.value.autoEscalated).toBe(true);

    const flag = await prisma.moderationAction.findFirstOrThrow({
      where: { targetId: jobId, action: 'flag:auto_review_threshold' },
    });
    expect(flag.actorId).toBeNull(); // system action
  });

  it('rejects reporting yourself and missing targets', async () => {
    const user = await makeUser({ role: 'worker' });
    const self = await safetyService.reportEntity({
      reporterId: user.id,
      input: { target_type: 'user', target_id: user.id, reason: 'spam', idempotency_key: newKey() },
    });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe('VALIDATION');

    const missing = await safetyService.reportEntity({
      reporterId: user.id,
      input: {
        target_type: 'job',
        target_id: '00000000-0000-0000-0000-0000000000ff',
        reason: 'spam',
        idempotency_key: newKey(),
      },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('NOT_FOUND');
  });
});

describe('blocking (§25.9 / F11)', () => {
  async function acceptedConversation() {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    const jobId = await postJob(employer.id);
    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error('apply failed');
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: { slot_id: slot.id, expected_slot_version: slot.version, idempotency_key: newKey() },
    });
    if (!accepted.ok) throw new Error('accept failed');
    return { employer, worker, conversationId: accepted.value.conversationId };
  }

  it('a block closes the chat channel in both directions', async () => {
    const { employer, worker, conversationId } = await acceptedConversation();

    // Employer blocks the worker.
    const blocked = await safetyService.blockUser({
      userId: employer.id,
      input: { blocked_id: worker.id, idempotency_key: newKey() },
    });
    expect(blocked.ok).toBe(true);

    // Worker → employer is blocked (symmetric)…
    const fromWorker = await chatService.sendMessage({
      conversationId,
      senderId: worker.id,
      input: { body: 'salam', idempotency_key: newKey() },
    });
    expect(fromWorker.ok).toBe(false);
    if (!fromWorker.ok) expect(fromWorker.code).toBe('FORBIDDEN');

    // …and employer → worker too.
    const fromEmployer = await chatService.sendMessage({
      conversationId,
      senderId: employer.id,
      input: { body: 'hi', idempotency_key: newKey() },
    });
    expect(fromEmployer.ok).toBe(false);

    // Unblock reopens the channel.
    await safetyService.unblockUser({ userId: employer.id, blockedId: worker.id });
    const after = await chatService.sendMessage({
      conversationId,
      senderId: worker.id,
      input: { body: 'salam again', idempotency_key: newKey() },
    });
    expect(after.ok).toBe(true);
  });
});

describe('F1 — fee language in a job posting', () => {
  it('raises a fee_request fraud signal on the employer at post time', async () => {
    const employer = await makeUser({ role: 'employer' });
    await postJob(employer.id, {
      title: 'mason wanted',
      description: 'pay a 500 registration fee first to join',
    });
    const sig = await prisma.fraudSignal.findFirstOrThrow({ where: { userId: employer.id } });
    expect(sig.signal).toBe('fee_request_in_job');
    expect(sig.weight).toBe(80);
  });

  it('a clean job posting raises no signal', async () => {
    const employer = await makeUser({ role: 'employer' });
    await postJob(employer.id, { title: 'mason wanted', description: 'build a wall, 2 days' });
    expect(await prisma.fraudSignal.count({ where: { userId: employer.id } })).toBe(0);
  });
});

describe('moderation + ban gating (§9)', () => {
  async function moderator() {
    const mod = await makeUser({ role: 'worker' });
    await prisma.userRole.create({ data: { userId: mod.id, role: 'moderator' } });
    return mod;
  }

  it('ban flips status + writes an audit row, and blocks re-login; lift restores it', async () => {
    const mod = await moderator();
    // A real returning user with a known, schema-valid phone (+92 then exactly 10
    // digits, mobile prefix 3) so we can drive requestOtp/verifyOtp.
    const phone = `+923${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const target = await prisma.user.create({
      data: { phoneE164: phone, displayName: 'target', roles: { create: [{ role: 'worker' }] } },
    });

    const banned = await safetyService.moderateUser({
      actorId: mod.id,
      targetUserId: target.id,
      input: { verb: 'ban', reason: 'advance_fee_scam', idempotency_key: newKey() },
    });
    expect(banned.ok).toBe(true);
    if (banned.ok) expect(banned.value.newStatus).toBe('banned');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.status).toBe('banned');
    expect(after.statusReason).toBe('advance_fee_scam');

    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { targetId: target.id, action: 'moderate:ban' },
    });
    expect(action.actorId).toBe(mod.id);

    // Banned user can't get a session.
    const reqOtp = await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'devicefp-123456' });
    expect(reqOtp.ok).toBe(true);
    const otp = await __test_getPendingOtp(phone)!;
    const login = await authService.verifyOtp({ phone_e164: phone, otp, device_fingerprint: 'devicefp-123456' });
    expect(login.ok).toBe(false);
    if (!login.ok) expect(login.code).toBe('FORBIDDEN');

    // Lift restores active + lets them back in.
    const lifted = await safetyService.moderateUser({
      actorId: mod.id,
      targetUserId: target.id,
      input: { verb: 'lift', reason: 'appeal_granted', idempotency_key: newKey() },
    });
    expect(lifted.ok).toBe(true);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(restored.status).toBe('active');
    expect(restored.statusReason).toBeNull();

    await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'devicefp-123456' });
    const otp2 = await __test_getPendingOtp(phone)!;
    const login2 = await authService.verifyOtp({ phone_e164: phone, otp: otp2, device_fingerprint: 'devicefp-123456' });
    expect(login2.ok).toBe(true);
  });

  it('suspend requires expires_at', async () => {
    const mod = await moderator();
    const target = await makeUser({ role: 'worker' });
    const res = await safetyService.moderateUser({
      actorId: mod.id,
      targetUserId: target.id,
      input: { verb: 'suspend', reason: 'investigating', idempotency_key: newKey() },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('VALIDATION');
  });

  it('re-banning an already-banned user is idempotent — no duplicate audit row or notification', async () => {
    const mod = await moderator();
    const target = await makeUser({ role: 'worker' });

    const first = await safetyService.moderateUser({
      actorId: mod.id,
      targetUserId: target.id,
      input: { verb: 'ban', reason: 'scam', idempotency_key: newKey() },
    });
    const second = await safetyService.moderateUser({
      actorId: mod.id,
      targetUserId: target.id,
      input: { verb: 'ban', reason: 'scam', idempotency_key: newKey() },
    });
    expect(first.ok && second.ok).toBe(true);

    // Exactly ONE ban moderation action + ONE ban notification, despite two calls.
    const actions = await prisma.moderationAction.count({
      where: { targetId: target.id, action: 'moderate:ban' },
    });
    expect(actions).toBe(1);
    const notifs = await prisma.notification.count({ where: { userId: target.id, type: 'account.ban' } });
    expect(notifs).toBe(1);
  });
});

describe('reports ops queue (§18)', () => {
  async function moderator() {
    const mod = await makeUser({ role: 'worker' });
    await prisma.userRole.create({ data: { userId: mod.id, role: 'moderator' } });
    return mod;
  }

  it('groups open reports by target with count, distinct reporters, top reason, offender + weight', async () => {
    const employer = await makeUser({ role: 'employer' });
    const jobId = await postJob(employer.id);

    // Two distinct reporters; the higher-weight reason (fee_request=80) should win over scam=70.
    const r1 = await makeUser({ role: 'worker' });
    const r2 = await makeUser({ role: 'worker' });
    await safetyService.reportEntity({
      reporterId: r1.id,
      input: { target_type: 'job', target_id: jobId, reason: 'scam', idempotency_key: newKey() },
    });
    await safetyService.reportEntity({
      reporterId: r2.id,
      input: { target_type: 'job', target_id: jobId, reason: 'fee_request', idempotency_key: newKey() },
    });

    const q = await safetyService.listReportsQueue();
    expect(q.ok).toBe(true);
    if (q.ok) {
      const row = q.value.find((x) => x.targetId === jobId);
      expect(row).toBeDefined();
      expect(row!.reportCount).toBe(2);
      expect(row!.distinctReporters).toBe(2);
      expect(row!.topReason).toBe('fee_request'); // highest weight wins
      expect(row!.offenderId).toBe(employer.id); // job → employer
      // Two report signals on the employer: scam(70) + fee_request(80) = 150.
      expect(row!.offenderFraudWeight).toBe(150);
    }
  });

  it('resolve(dismiss) closes the open reports and writes an audit row, no ban', async () => {
    const employer = await makeUser({ role: 'employer' });
    const jobId = await postJob(employer.id);
    const reporter = await makeUser({ role: 'worker' });
    await safetyService.reportEntity({
      reporterId: reporter.id,
      input: { target_type: 'job', target_id: jobId, reason: 'spam', idempotency_key: newKey() },
    });
    const mod = await moderator();

    const res = await safetyService.resolveReports({
      actorId: mod.id,
      targetType: 'job',
      targetId: jobId,
      decision: 'dismiss',
      note: 'looks legit',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.closed).toBe(1);
      expect(res.value.banned).toBe(false);
    }

    // No longer in the open queue.
    const q = await safetyService.listReportsQueue();
    if (q.ok) expect(q.value.find((x) => x.targetId === jobId)).toBeUndefined();

    const report = await prisma.report.findFirstOrThrow({ where: { targetId: jobId } });
    expect(report.status).toBe('dismissed');
    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { targetId: jobId, action: 'reports:dismiss' },
    });
    expect(action.actorId).toBe(mod.id);
  });

  it('resolve(action, ban) on a reported USER bans the offender through the audited path', async () => {
    const offender = await makeUser({ role: 'worker' });
    const reporter = await makeUser({ role: 'worker' });
    await safetyService.reportEntity({
      reporterId: reporter.id,
      input: { target_type: 'user', target_id: offender.id, reason: 'harassment', idempotency_key: newKey() },
    });
    const mod = await moderator();

    const res = await safetyService.resolveReports({
      actorId: mod.id,
      targetType: 'user',
      targetId: offender.id,
      decision: 'action',
      note: 'harassment confirmed',
      ban: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.banned).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: offender.id } });
    expect(after.status).toBe('banned');
    const report = await prisma.report.findFirstOrThrow({ where: { targetId: offender.id } });
    expect(report.status).toBe('actioned');
  });
});

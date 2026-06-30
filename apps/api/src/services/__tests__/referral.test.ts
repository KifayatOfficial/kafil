// §10 F7 referral + anti-farming tests. Real Postgres.
//
// Invariants:
//  1. A user gets one stable shareable code (idempotent generation).
//  2. Claim rules: can't self-refer, can't be referred twice, unknown code → 404.
//  3. Reward is paid ONLY on the referred user's FIRST completed job, exactly once,
//     and moves platform_revenue → referrer wallet as a balanced ledger txn.
//  4. Same-device referrer/referred → rejected_fraud, a fraud signal, and NO reward.
//  5. Daily velocity cap blocks mass claims against one referrer.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { referralService } from '../referral.service';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

/** Mark a device fingerprint as belonging to a user (for same-device tests). */
async function bindDevice(userId: string, fingerprint: string) {
  await prisma.device.create({ data: { userId, deviceFingerprint: fingerprint } });
}

/** Create a completed assignment for a worker (the qualify trigger). Returns nothing. */
async function completeAssignmentFor(workerId: string) {
  const employer = await makeUser({ role: 'employer' });
  const loc = await prisma.location.create({
    data: { label: 'l', district: 'Swat', tehsil: 'B', lat: 34.7, lng: 72.3, precision: 'pin' },
  });
  const job = await prisma.job.create({
    data: { employerId: employer.id, title: 'j', locationId: loc.id, headcount: 1, ratePkr: 1000, rateUnit: 'day', status: 'completed', paymentMode: 'cash' },
  });
  const slot = await prisma.jobSlot.create({ data: { jobId: job.id, slotIndex: 1, status: 'completed' } });
  await prisma.assignment.create({
    data: { jobId: job.id, slotId: slot.id, workerId, status: 'completed', agreedRatePkr: 1000 },
  });
}

async function setReward(minor: number) {
  await prisma.setting.upsert({
    where: { key: 'referral.reward_minor' },
    create: { key: 'referral.reward_minor', value: minor },
    update: { value: minor },
  });
}

async function referrerBalance(referrerId: string): Promise<bigint> {
  const w = await prisma.wallet.findFirst({ where: { userId: referrerId, kind: 'user' } });
  return w?.balanceMinor ?? 0n;
}

describe('referral — code generation', () => {
  it('returns one stable code across repeated calls', async () => {
    const u = await makeUser({ role: 'worker' });
    const a = await referralService.getOrCreateMyCode(u.id);
    const b = await referralService.getOrCreateMyCode(u.id);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.code).toBe(b.value.code);
  });
});

describe('referral — claim validation', () => {
  it('rejects an unknown code', async () => {
    const u = await makeUser({ role: 'worker' });
    const r = await referralService.claim({ referredUserId: u.id, code: 'KZZZZZZ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('refuses self-referral', async () => {
    const u = await makeUser({ role: 'worker' });
    const code = await referralService.getOrCreateMyCode(u.id);
    const r = code.ok
      ? await referralService.claim({ referredUserId: u.id, code: code.value.code })
      : null;
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.code).toBe('CONFLICT');
  });

  it('refuses a second referral for an already-referred user', async () => {
    const ref = await makeUser({ role: 'worker' });
    const ref2 = await makeUser({ role: 'worker' });
    const newbie = await makeUser({ role: 'worker' });
    const c1 = await referralService.getOrCreateMyCode(ref.id);
    const c2 = await referralService.getOrCreateMyCode(ref2.id);
    expect(c1.ok && c2.ok).toBe(true);
    if (!c1.ok || !c2.ok) return;
    const first = await referralService.claim({ referredUserId: newbie.id, code: c1.value.code });
    expect(first.ok).toBe(true);
    const second = await referralService.claim({ referredUserId: newbie.id, code: c2.value.code });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('CONFLICT');
  });
});

describe('referral — qualify on first completed job (§10 F7)', () => {
  it('pays the referrer exactly once, on the first completion, via the ledger', async () => {
    await setReward(30_000);
    const referrer = await makeUser({ role: 'worker' });
    const newbie = await makeUser({ role: 'worker' });
    const code = await referralService.getOrCreateMyCode(referrer.id);
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    await referralService.claim({ referredUserId: newbie.id, code: code.value.code });

    // No completion yet → still pending, no reward.
    await referralService.qualifyOnFirstCompletion(newbie.id);
    expect(await referrerBalance(referrer.id)).toBe(0n);

    // First completed job → qualify + pay 300 PKR.
    await completeAssignmentFor(newbie.id);
    await referralService.qualifyOnFirstCompletion(newbie.id);
    expect(await referrerBalance(referrer.id)).toBe(30_000n);

    const row = await prisma.referral.findFirst({ where: { referredId: newbie.id } });
    expect(row?.status).toBe('qualified');
    expect(row?.rewardMinor).toBe(30_000);

    // Idempotent: a second completion + re-trigger does NOT double-pay.
    await completeAssignmentFor(newbie.id);
    await referralService.qualifyOnFirstCompletion(newbie.id);
    expect(await referrerBalance(referrer.id)).toBe(30_000n);
  });

  it('does nothing when the user has no referral', async () => {
    const lonely = await makeUser({ role: 'worker' });
    await completeAssignmentFor(lonely.id);
    await referralService.qualifyOnFirstCompletion(lonely.id); // must not throw
    expect(true).toBe(true);
  });
});

describe('referral — anti-farming', () => {
  it('marks a same-device claim rejected_fraud with a fraud signal and no reward path', async () => {
    const referrer = await makeUser({ role: 'worker' });
    const sock = await makeUser({ role: 'worker' });
    const fp = 'device-shared-xyz';
    await bindDevice(referrer.id, fp);
    await bindDevice(sock.id, fp);

    const code = await referralService.getOrCreateMyCode(referrer.id);
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    // Claim succeeds at the API surface (we don't reveal the rule) but is poisoned.
    const r = await referralService.claim({
      referredUserId: sock.id,
      code: code.value.code,
      deviceFingerprint: fp,
    });
    expect(r.ok).toBe(true);

    const row = await prisma.referral.findFirst({ where: { referredId: sock.id } });
    expect(row?.status).toBe('rejected_fraud');

    const signal = await prisma.fraudSignal.findFirst({
      where: { userId: referrer.id, signal: 'referral_self_same_device' },
    });
    expect(signal).not.toBeNull();

    // Even after a completed job, a rejected_fraud claim never pays.
    await completeAssignmentFor(sock.id);
    await referralService.qualifyOnFirstCompletion(sock.id);
    expect(await referrerBalance(referrer.id)).toBe(0n);
  });

  it('enforces the daily claim velocity cap', async () => {
    await prisma.setting.upsert({
      where: { key: 'referral.daily_claim_cap' },
      create: { key: 'referral.daily_claim_cap', value: 1 },
      update: { value: 1 },
    });
    const referrer = await makeUser({ role: 'worker' });
    const code = await referralService.getOrCreateMyCode(referrer.id);
    expect(code.ok).toBe(true);
    if (!code.ok) return;

    const a = await makeUser({ role: 'worker' });
    const b = await makeUser({ role: 'worker' });
    const first = await referralService.claim({ referredUserId: a.id, code: code.value.code });
    expect(first.ok).toBe(true);
    const second = await referralService.claim({ referredUserId: b.id, code: code.value.code });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('RATE_LIMIT');
  });
});

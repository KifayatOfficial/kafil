// §6 wallet top-up tests. Real Postgres.
//
// Invariants:
//  1. initiateTopUp creates a pending Payment; completeTopUpForPayment credits the
//     user's wallet exactly once and the books reconcile.
//  2. A duplicate completion (or replayed webhook) does not double-credit.
//  3. The PSP webhook routes a wallet_topup payment to the wallet (not escrow).
//  4. Topped-up balance is then usable to feature a job (the whole point — unblocks
//     cash-mode monetization revenue).
//  5. Min/max guards reject dust and fat-finger amounts.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { walletService } from '../wallet.service';
import { webhookService } from '../webhook.service';
import { monetizationService } from '../monetization.service';
import { jobService } from '../job.service';
import { reconcileWallets } from '../ledger';
import { signWebhookBody } from '../../providers/webhook.provider';
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

async function balance(userId: string): Promise<bigint> {
  const w = await prisma.wallet.findFirst({ where: { userId, kind: 'user' } });
  return w?.balanceMinor ?? 0n;
}

function signed(body: object) {
  const rawBody = JSON.stringify(body);
  return { rawBody, signature: signWebhookBody(rawBody) };
}

describe('wallet top-up — direct service path', () => {
  it('credits the user wallet once and reconciles the books', async () => {
    const user = await makeUser({ role: 'employer' });
    const init = await walletService.initiateTopUp({
      userId: user.id,
      amountMinor: 50_000n, // 500 PKR
      idempotencyKey: newKey(),
    });
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    expect(await balance(user.id)).toBe(0n); // pending only — nothing credited yet

    const done = await walletService.completeTopUpForPayment({ paymentId: init.value.paymentId });
    expect(done.ok).toBe(true);
    expect(await balance(user.id)).toBe(50_000n);
    expect(await reconcileWallets()).toEqual([]);

    // Idempotent: a second completion is a no-op (no double-credit).
    const again = await walletService.completeTopUpForPayment({ paymentId: init.value.paymentId });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.alreadyDone).toBe(true);
    expect(await balance(user.id)).toBe(50_000n);
  });

  it('rejects a dust top-up below the floor', async () => {
    const user = await makeUser({ role: 'employer' });
    const r = await walletService.initiateTopUp({ userId: user.id, amountMinor: 100n, idempotencyKey: newKey() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION');
  });

  it('is idempotent on the initiate key (no duplicate pending payments)', async () => {
    const user = await makeUser({ role: 'employer' });
    const key = newKey();
    const a = await walletService.initiateTopUp({ userId: user.id, amountMinor: 20_000n, idempotencyKey: key });
    const b = await walletService.initiateTopUp({ userId: user.id, amountMinor: 20_000n, idempotencyKey: key });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.paymentId).toBe(b.value.paymentId);
  });
});

describe('wallet top-up — PSP webhook routing', () => {
  it('routes a wallet_topup payment.succeeded to the wallet, not escrow', async () => {
    const user = await makeUser({ role: 'employer' });
    const init = await walletService.initiateTopUp({
      userId: user.id,
      amountMinor: 30_000n,
      idempotencyKey: newKey(),
    });
    if (!init.ok) throw new Error('initiate failed');

    const { rawBody, signature } = signed({
      provider: 'jazzcash',
      provider_ref: 'topup-txn-1',
      event_type: 'payment.succeeded',
      payment_id: init.value.paymentId,
      amount_minor: init.value.amountMinor,
    });
    const res = await webhookService.ingest({ rawBody, signature });
    expect(res.ok).toBe(true);

    expect(await balance(user.id)).toBe(30_000n);
    // Escrow must NOT have been touched by a top-up.
    const escrow = await prisma.wallet.findFirst({ where: { kind: 'escrow_holding' } });
    expect(escrow?.balanceMinor ?? 0n).toBe(0n);
    expect(await reconcileWallets()).toEqual([]);
  });
});

describe('wallet top-up — unblocks featuring (§6.1)', () => {
  it('a topped-up employer can then feature their job', async () => {
    const employer = await makeUser({ role: 'employer' });
    // Top up 200 PKR.
    const init = await walletService.initiateTopUp({ userId: employer.id, amountMinor: 20_000n, idempotencyKey: newKey() });
    if (!init.ok) throw new Error();
    await walletService.completeTopUpForPayment({ paymentId: init.value.paymentId });

    // Post a job, then feature it (150 PKR fee).
    const loc = await makeLocation();
    const spec = await ensureMasonrySpecialty();
    const created = await jobService.createJob({
      employerId: employer.id,
      input: {
        title: 'boost me', location_id: loc.id, headcount: 1, rate_pkr: 3000, rate_unit: 'day',
        specialty_ids: [spec.id], idempotency_key: newKey(), payment_mode: 'cash',
      },
    });
    if (!created.ok) throw new Error();

    const feat = await monetizationService.featureJob({ jobId: created.value.jobId, employerId: employer.id });
    expect(feat.ok).toBe(true);
    expect(await balance(employer.id)).toBe(20_000n - 15_000n); // 200 - 150 PKR
    expect(await reconcileWallets()).toEqual([]);
  });
});

// Payout / cash-out integration tests (§6). Real Postgres.
//
// Invariants:
//  1. A worker with a funded wallet + KYC>=2 can withdraw; the wallet is debited,
//     gateway-clearing credited, a Payout row is 'sent', books reconcile.
//  2. Withdrawing more than the balance is rejected (CONFLICT) and moves no money.
//  3. KYC < 2 is rejected (FORBIDDEN) — money-out needs CNIC verification.
//  4. Re-requesting with the same idempotency key returns the original payout (no
//     second disbursement).
//  5. Below-minimum amounts are rejected.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';
import { payoutService } from '../payout.service';
import { reconcileWallets, ensureWallet, writeLedgerTxn } from '../ledger';
import { cleanupTestData, makeUser, newKey } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

/**
 * Seed a worker wallet with `amountMinor` via a balanced ledger txn (gateway-clearing
 * → worker), mirroring how an escrow release credits a worker — keeps the books valid.
 */
async function fundWorkerWallet(workerId: string, amountMinor: bigint) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const worker = await ensureWallet(tx, { userId: workerId, kind: 'user' });
    const gw = await ensureWallet(tx, { userId: null, kind: 'payment_gateway_clearing' });
    await writeLedgerTxn(tx, {
      legs: [
        { walletId: gw.id, amountMinor: -amountMinor, reason: 'escrow_release', refType: 'assignment', refId: worker.id },
        { walletId: worker.id, amountMinor, reason: 'escrow_release', refType: 'assignment', refId: worker.id },
      ],
    });
  });
}

describe('payout / cash-out (§6)', () => {
  it('debits the worker wallet, marks the payout sent, and reconciles', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    await fundWorkerWallet(worker.id, 500_000n);

    const r = await payoutService.requestPayout({
      workerId: worker.id,
      amountMinor: 300_000n,
      idempotencyKey: newKey(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('sent');

    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id, kind: 'user' } });
    expect(wallet.balanceMinor).toBe(200_000n);

    const payout = await prisma.payout.findFirstOrThrow({ where: { workerId: worker.id } });
    expect(payout.status).toBe('sent');
    expect(payout.amountMinor).toBe(300_000n);

    expect(await reconcileWallets()).toEqual([]);
  });

  it('rejects withdrawing more than the balance (CONFLICT), moving no money', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    await fundWorkerWallet(worker.id, 100_000n);

    const r = await payoutService.requestPayout({
      workerId: worker.id,
      amountMinor: 250_000n,
      idempotencyKey: newKey(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFLICT');

    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id, kind: 'user' } });
    expect(wallet.balanceMinor).toBe(100_000n); // untouched
    expect(await prisma.payout.count({ where: { workerId: worker.id } })).toBe(0);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('rejects a worker below KYC level 2 (FORBIDDEN)', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 1 });
    await fundWorkerWallet(worker.id, 500_000n);

    const r = await payoutService.requestPayout({
      workerId: worker.id,
      amountMinor: 100_000n,
      idempotencyKey: newKey(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN');
    expect(await prisma.payout.count({ where: { workerId: worker.id } })).toBe(0);
  });

  it('is idempotent — same key returns the original payout, pays once', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    await fundWorkerWallet(worker.id, 500_000n);
    const key = newKey();

    const first = await payoutService.requestPayout({ workerId: worker.id, amountMinor: 200_000n, idempotencyKey: key });
    const second = await payoutService.requestPayout({ workerId: worker.id, amountMinor: 200_000n, idempotencyKey: key });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.payoutId).toBe(first.value.payoutId);

    expect(await prisma.payout.count({ where: { workerId: worker.id } })).toBe(1);
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id, kind: 'user' } });
    expect(wallet.balanceMinor).toBe(300_000n); // debited once
    expect(await reconcileWallets()).toEqual([]);
  });

  it('rejects below-minimum amounts', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    await fundWorkerWallet(worker.id, 500_000n);
    const r = await payoutService.requestPayout({ workerId: worker.id, amountMinor: 5_000n, idempotencyKey: newKey() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION');
  });

  it('getWallet returns balance + recent payouts', async () => {
    const worker = await makeUser({ role: 'worker', kyc: 2 });
    await fundWorkerWallet(worker.id, 500_000n);
    await payoutService.requestPayout({ workerId: worker.id, amountMinor: 100_000n, idempotencyKey: newKey() });

    const w = await payoutService.getWallet(worker.id);
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.value.balanceMinor).toBe('400000');
      expect(w.value.recentPayouts).toHaveLength(1);
      expect(w.value.recentPayouts[0]!.status).toBe('sent');
    }
  });
});

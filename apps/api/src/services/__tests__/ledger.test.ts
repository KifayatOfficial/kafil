// Ledger + escrow tests. These are the most consequential tests in the project:
// they verify money doesn't drift, the double-entry invariant holds, and the
// reconciliation step catches tampering.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import {
  ensureWallet,
  fundEscrow,
  releaseEscrow,
  refundEscrow,
  partialSettle,
  reconcileWallets,
  writeLedgerTxn,
} from '../ledger';
import {
  cleanupTestData,
  makeUser,
} from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('ledger primitive — double-entry invariant', () => {
  it('writeLedgerTxn refuses an unbalanced set of legs', async () => {
    const employer = await makeUser({ role: 'employer' });
    await prisma.$transaction(async (tx) => {
      const w = await ensureWallet(tx, { userId: employer.id, kind: 'user' });
      await expect(
        writeLedgerTxn(tx, {
          legs: [
            { walletId: w.id, amountMinor: 100n, reason: 'refund' },
            { walletId: w.id, amountMinor: 50n, reason: 'refund' },
          ],
        }),
      ).rejects.toThrow(/unbalanced/);
    });
  });

  it('writeLedgerTxn commits a balanced txn + updates wallet balances', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    await prisma.$transaction(async (tx) => {
      const a = await ensureWallet(tx, { userId: employer.id, kind: 'user' });
      const b = await ensureWallet(tx, { userId: worker.id, kind: 'user' });
      await writeLedgerTxn(tx, {
        legs: [
          { walletId: a.id, amountMinor: -1000n, reason: 'tip' },
          { walletId: b.id, amountMinor: 1000n, reason: 'tip' },
        ],
      });
    });

    const wa = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id } });
    const wb = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id } });
    expect(wa.balanceMinor).toBe(-1000n);
    expect(wb.balanceMinor).toBe(1000n);
  });

  it('reconcileWallets catches a cache that drifts from the ledger', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    await prisma.$transaction(async (tx) => {
      const a = await ensureWallet(tx, { userId: employer.id, kind: 'user' });
      const b = await ensureWallet(tx, { userId: worker.id, kind: 'user' });
      await writeLedgerTxn(tx, {
        legs: [
          { walletId: a.id, amountMinor: -500n, reason: 'tip' },
          { walletId: b.id, amountMinor: 500n, reason: 'tip' },
        ],
      });
    });
    // Initially clean.
    expect(await reconcileWallets()).toEqual([]);

    // Tamper with the cache directly (simulating a code bug / external write).
    await prisma.wallet.updateMany({ where: { userId: worker.id }, data: { balanceMinor: 999_999n } });
    const drift = await reconcileWallets();
    expect(drift).toHaveLength(1);
    expect(drift[0]!.cached).toBe(999_999n);
    expect(drift[0]!.truth).toBe(500n);
  });
});

describe('escrow flows', () => {
  it('fundEscrow moves money into escrow_holding via the clearing wallet', async () => {
    const job = { refType: 'job', refId: '00000000-0000-0000-0000-000000000abc' };
    await prisma.$transaction((tx) => fundEscrow(tx, { amountMinor: 50_000n, ...job }));

    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    const clearing = await prisma.wallet.findFirstOrThrow({ where: { kind: 'payment_gateway_clearing' } });
    expect(escrow.balanceMinor).toBe(50_000n);
    expect(clearing.balanceMinor).toBe(-50_000n);
    // The two legs balance: -50_000 + 50_000 = 0.
    expect(await reconcileWallets()).toEqual([]);
  });

  it('releaseEscrow pays worker net + platform commission, draining escrow', async () => {
    const worker = await makeUser({ role: 'worker' });
    const job = { refType: 'job', refId: '00000000-0000-0000-0000-000000000def' };
    await prisma.$transaction((tx) => fundEscrow(tx, { amountMinor: 100_000n, ...job }));
    await prisma.$transaction((tx) =>
      releaseEscrow(tx, {
        workerId: worker.id,
        grossMinor: 100_000n,
        commissionMinor: 5_000n, // 5%
        refType: 'assignment',
        refId: '00000000-0000-0000-0000-000000000111',
      }),
    );

    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    const platform = await prisma.wallet.findFirstOrThrow({ where: { kind: 'platform_revenue' } });
    const workerW = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id } });
    expect(escrow.balanceMinor).toBe(0n);
    expect(platform.balanceMinor).toBe(5_000n);
    expect(workerW.balanceMinor).toBe(95_000n);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('refundEscrow returns the funded amount to the employer', async () => {
    const employer = await makeUser({ role: 'employer' });
    const job = { refType: 'job', refId: '00000000-0000-0000-0000-0000000abc01' };
    await prisma.$transaction((tx) => fundEscrow(tx, { amountMinor: 30_000n, ...job }));
    await prisma.$transaction((tx) =>
      refundEscrow(tx, {
        employerId: employer.id,
        amountMinor: 30_000n,
        refType: 'assignment',
        refId: '00000000-0000-0000-0000-0000000abc02',
      }),
    );

    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id } });
    expect(escrow.balanceMinor).toBe(0n);
    expect(empW.balanceMinor).toBe(30_000n);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('partialSettle splits funds three ways and balances', async () => {
    const employer = await makeUser({ role: 'employer' });
    const worker = await makeUser({ role: 'worker' });
    await prisma.$transaction((tx) =>
      fundEscrow(tx, { amountMinor: 100_000n, refType: 'job', refId: '00000000-0000-0000-0000-000000000aaa' }),
    );
    await prisma.$transaction((tx) =>
      partialSettle(tx, {
        workerId: worker.id,
        employerId: employer.id,
        grossMinor: 100_000n,
        payoutMinor: 60_000n,
        refundMinor: 37_000n,
        commissionMinor: 3_000n,
        refType: 'assignment',
        refId: '00000000-0000-0000-0000-000000000bbb',
      }),
    );

    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    const platform = await prisma.wallet.findFirstOrThrow({ where: { kind: 'platform_revenue' } });
    const workerW = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id } });
    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id } });
    expect(escrow.balanceMinor).toBe(0n);
    expect(workerW.balanceMinor).toBe(60_000n);
    expect(empW.balanceMinor).toBe(37_000n);
    expect(platform.balanceMinor).toBe(3_000n);
    expect(await reconcileWallets()).toEqual([]);
  });
});

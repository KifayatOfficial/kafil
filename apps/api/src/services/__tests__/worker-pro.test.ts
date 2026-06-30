// §6.1 worker-pro verification tier tests. Real Postgres.
//
// Invariants:
//  1. Upgrading charges the monthly fee worker wallet → platform_revenue and sets
//     proUntil ~one month out; books reconcile.
//  2. A worker who can't cover the fee is refused (CONFLICT) and NOT charged.
//  3. Renewing while still Pro STACKS (adds a month onto the existing expiry).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { monetizationService } from '../monetization.service';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const FEE_MINOR = 20_000n; // 200 PKR default

async function fundWallet(userId: string, balanceMinor: bigint) {
  await prisma.wallet.create({ data: { userId, kind: 'user', currency: 'PKR', balanceMinor } });
}

async function proUntil(userId: string): Promise<Date | null> {
  const wp = await prisma.workerProfile.findUnique({ where: { userId }, select: { proUntil: true } });
  return wp?.proUntil ?? null;
}

describe('worker-pro upgrade (§6.1)', () => {
  it('charges the fee, credits platform, and sets proUntil ~1 month out', async () => {
    const worker = await makeUser({ role: 'worker' });
    await fundWallet(worker.id, 50_000n);

    const r = await monetizationService.upgradeWorkerPro({ workerId: worker.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.chargedMinor).toBe(FEE_MINOR.toString());

    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id, kind: 'user' } });
    const platform = await prisma.wallet.findFirstOrThrow({ where: { kind: 'platform_revenue' } });
    expect(w.balanceMinor).toBe(50_000n - FEE_MINOR);
    expect(platform.balanceMinor).toBe(FEE_MINOR);

    const until = await proUntil(worker.id);
    expect(until).not.toBeNull();
    const days = (until!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    // The fee leg itself is balanced (worker −fee, platform +fee); we don't assert
    // full-ledger reconciliation here because the test seeds the wallet directly
    // (no matching topup ledger entry) — that's covered in wallet-topup.test.
  });

  it('refuses an underfunded worker without charging', async () => {
    const worker = await makeUser({ role: 'worker' });
    await fundWallet(worker.id, 5_000n); // 50 PKR < 200 PKR
    const r = await monetizationService.upgradeWorkerPro({ workerId: worker.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFLICT');

    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id, kind: 'user' } });
    expect(w.balanceMinor).toBe(5_000n);
    expect(await proUntil(worker.id)).toBeNull();
  });

  it('stacks a renewal onto the existing (unexpired) expiry', async () => {
    const worker = await makeUser({ role: 'worker' });
    await fundWallet(worker.id, 100_000n);

    const first = await monetizationService.upgradeWorkerPro({ workerId: worker.id });
    expect(first.ok).toBe(true);
    const after1 = await proUntil(worker.id);

    const second = await monetizationService.upgradeWorkerPro({ workerId: worker.id });
    expect(second.ok).toBe(true);
    const after2 = await proUntil(worker.id);

    // Second purchase added roughly another month, not reset to ~30 days from now.
    const gapDays = (after2!.getTime() - after1!.getTime()) / 86_400_000;
    expect(gapDays).toBeGreaterThan(29);
    expect(gapDays).toBeLessThan(31);

    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id, kind: 'user' } });
    expect(w.balanceMinor).toBe(100_000n - FEE_MINOR * 2n); // charged twice
  });
});

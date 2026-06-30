// §6.1 / §21.2 — cash-mode monetization: featured ("boosted") job posts.
//
// This is the revenue mechanism the corrected financial model leans on: it's charged
// at the moment of value (the employer wants visibility NOW), before any service is
// delivered, so collection is structurally ~100% — unlike trailing commission, which
// §5/§21.2 deliberately disables. The fee moves the employer's wallet → platform_revenue
// as a balanced ledger txn (P3) in the same transaction that stamps `featured_until`.
//
// Wallet model: the employer pays from their KAFIL wallet (topped up via the same PSP
// path escrow funding uses). We guard on balance and never let the wallet go negative —
// an unfunded employer gets a clear "top up first" error rather than silent debt.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { ensureWallet, writeLedgerTxn } from './ledger';

const DEFAULT_FEATURED_POST_PKR = 150; // §6.1
const FEATURE_DURATION_MS = 24 * 60 * 60_000; // boosted to top for 24h (§6.1)
const DEFAULT_WORKER_PRO_PKR = 200; // §6.1
const PRO_PERIOD_MS = 30 * 24 * 60 * 60_000; // one month of Pro per purchase

async function loadInt(key: string, fallback: number): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key } });
  const v = s?.value as number | null | undefined;
  return typeof v === 'number' ? v : fallback;
}

export const monetizationService = {
  /**
   * Charge the employer the featured-post fee and boost their job to the top of the
   * feed for the configured window. Idempotency is by INTENT, not by key: re-featuring
   * an already-currently-featured job is rejected (CONFLICT) so a double-tap can't
   * double-charge. Featuring again AFTER the window lapsed is allowed (a new boost).
   */
  async featureJob(args: {
    jobId: string;
    employerId: string;
    now?: Date;
  }): Promise<Result<{ featuredUntil: string; chargedMinor: string }>> {
    const now = args.now ?? new Date();
    const job = await prisma.job.findUnique({
      where: { id: args.jobId },
      select: { id: true, employerId: true, status: true, featuredUntil: true },
    });
    if (!job) return err('NOT_FOUND', 'job not found');
    if (job.employerId !== args.employerId) return err('FORBIDDEN', 'not your job');
    // Only an open job is worth boosting; a filled/closed job in the feed top is waste.
    if (job.status !== 'open') return err('CONFLICT', 'only an open job can be featured');
    // Already currently featured → don't let a double-tap double-charge.
    if (job.featuredUntil && job.featuredUntil > now) {
      return err('CONFLICT', 'this job is already featured');
    }

    const feePkr = await loadInt('cash.featured_post.pkr', DEFAULT_FEATURED_POST_PKR);
    const feeMinor = BigInt(feePkr) * 100n; // PKR → paisa
    const featuredUntil = new Date(now.getTime() + FEATURE_DURATION_MS);

    try {
      await prisma.$transaction(async (tx) => {
        // Lock + read the employer wallet; refuse if it can't cover the fee.
        const wallet = await ensureWallet(tx, { userId: args.employerId, kind: 'user' });
        const locked = await tx.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
          select: { balanceMinor: true },
        });
        if (locked.balanceMinor < feeMinor) throw new InsufficientFundsError();

        const platform = await ensureWallet(tx, { userId: null, kind: 'platform_revenue' });
        await writeLedgerTxn(tx, {
          legs: [
            { walletId: wallet.id, amountMinor: -feeMinor, reason: 'featured_post', refType: 'job', refId: job.id },
            { walletId: platform.id, amountMinor: feeMinor, reason: 'featured_post', refType: 'job', refId: job.id },
          ],
        });

        // Stamp the boost. Guard on the job still being open at write time.
        const upd = await tx.job.updateMany({
          where: { id: job.id, status: 'open' },
          data: { featuredUntil, version: { increment: 1 } },
        });
        if (upd.count === 0) throw new JobNotOpenError();

        await emitEvent(tx, {
          eventType: 'job.featured',
          actorId: args.employerId,
          refType: 'job',
          refId: job.id,
          payload: { fee_minor: feeMinor.toString(), featured_until: featuredUntil.toISOString() },
        });
      });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return err('CONFLICT', 'not enough balance — top up your wallet to feature this job');
      }
      if (e instanceof JobNotOpenError) {
        return err('CONFLICT', 'only an open job can be featured');
      }
      throw e;
    }

    return ok({ featuredUntil: featuredUntil.toISOString(), chargedMinor: feeMinor.toString() });
  },

  /** The current featured-post price, in whole PKR — for the UI's confirm copy. */
  async featuredPostPricePkr(): Promise<number> {
    return loadInt('cash.featured_post.pkr', DEFAULT_FEATURED_POST_PKR);
  },

  /**
   * Buy/extend the worker "Pro" tier (§6.1): charge the monthly fee from the worker's
   * wallet → platform_revenue and extend proUntil by one month. Stacks correctly —
   * buying while still Pro adds a month onto the existing expiry rather than resetting
   * it, so an early renewal is never punished. Balance-guarded; never goes negative.
   */
  async upgradeWorkerPro(args: {
    workerId: string;
    now?: Date;
  }): Promise<Result<{ proUntil: string; chargedMinor: string }>> {
    const now = args.now ?? new Date();
    const profile = await prisma.workerProfile.findUnique({
      where: { userId: args.workerId },
      select: { userId: true, proUntil: true },
    });
    if (!profile) return err('NOT_FOUND', 'worker profile not found — add the worker role first');

    const feePkr = await loadInt('verification.worker_pro.monthly_pkr', DEFAULT_WORKER_PRO_PKR);
    const feeMinor = BigInt(feePkr) * 100n;
    // Extend from the later of now or the current (unexpired) expiry.
    const base =
      profile.proUntil && profile.proUntil > now ? profile.proUntil.getTime() : now.getTime();
    const proUntil = new Date(base + PRO_PERIOD_MS);

    try {
      await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(tx, { userId: args.workerId, kind: 'user' });
        const locked = await tx.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
          select: { balanceMinor: true },
        });
        if (locked.balanceMinor < feeMinor) throw new InsufficientFundsError();

        const platform = await ensureWallet(tx, { userId: null, kind: 'platform_revenue' });
        await writeLedgerTxn(tx, {
          legs: [
            { walletId: wallet.id, amountMinor: -feeMinor, reason: 'verification_fee', refType: 'worker_pro', refId: args.workerId },
            { walletId: platform.id, amountMinor: feeMinor, reason: 'verification_fee', refType: 'worker_pro', refId: args.workerId },
          ],
        });
        await tx.workerProfile.update({
          where: { userId: args.workerId },
          data: { proUntil },
        });
        await emitEvent(tx, {
          eventType: 'worker.pro_upgraded',
          actorId: args.workerId,
          refType: 'user',
          refId: args.workerId,
          payload: { fee_minor: feeMinor.toString(), pro_until: proUntil.toISOString() },
        });
      });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return err('CONFLICT', 'not enough balance — top up your wallet to go Pro');
      }
      throw e;
    }

    return ok({ proUntil: proUntil.toISOString(), chargedMinor: feeMinor.toString() });
  },

  /** Current worker-pro monthly price, in whole PKR — for the UI confirm copy. */
  async workerProPricePkr(): Promise<number> {
    return loadInt('verification.worker_pro.monthly_pkr', DEFAULT_WORKER_PRO_PKR);
  },
};

class InsufficientFundsError extends Error {}
class JobNotOpenError extends Error {}

// Exported so tests can reuse the helper without re-reading settings semantics.
export const __monetizationInternals = { FEATURE_DURATION_MS };
export type { Prisma };

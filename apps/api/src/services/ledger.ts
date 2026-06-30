// Ledger transaction helper (§24/A2 + §26/M2).
//
// Contract:
//   - Every money movement is a balanced set of ledger entries that sum to zero.
//   - This helper makes "balanced by construction" the default. Callers describe
//     PAIRS (debit + credit) and the helper writes them under one txn_id.
//   - The Postgres deferred constraint trigger (prisma/sql/001_partial_indexes.sql)
//     refuses any committed txn that's unbalanced — defense in depth (§24/A2).
//   - Wallets carry a denormalized balance cache (`balance_minor`) for fast reads;
//     the LEDGER is the source of truth. reconcile() recomputes balances from
//     entries and reports drift.
//
// Currencies:
//   - PKR only in v0; FX entries land later (§26/M18) with a second wallet per pair.
//
// Wallet kinds (see schema):
//   - `user`              — per-user PKR balance. Workers receive payouts here.
//   - `platform_revenue`  — singleton; receives commission.
//   - `escrow_holding`    — singleton; funded escrows live here until release.
//   - `payment_gateway_clearing` — singleton; mirror of inbound PSP balance.
//
// Sign convention:
//   - Positive amount_minor = credit (money INTO this wallet).
//   - Negative amount_minor = debit (money OUT of this wallet).
//   - Every txn's entries sum to 0 (assets in = assets out).

import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db';

export type LedgerReason =
  | 'escrow_fund' // employer wallet → escrow_holding
  | 'escrow_release' // escrow_holding → worker wallet (net of commission)
  | 'commission' // escrow_holding → platform_revenue
  | 'refund' // escrow_holding → employer wallet (any reason)
  | 'payout' // worker wallet → payment_gateway_clearing (cash-out to PSP)
  | 'tip' // employer wallet → worker wallet (no commission)
  | 'partial_payout' // escrow_holding → worker wallet (partial dispute outcome)
  | 'partial_refund' // escrow_holding → employer wallet (partial dispute outcome)
  | 'reversal' // chargeback / lost dispute (mirror of any prior txn)
  | 'tax_collected'
  | 'fx_conversion'
  | 'referral_bonus'; // platform_revenue → referrer wallet (§10 F7, paid on qualifying referral)

export interface LedgerLeg {
  walletId: string;
  amountMinor: bigint;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
}

export interface LedgerEntryDraft {
  legs: LedgerLeg[];
}

/**
 * Write a balanced ledger transaction. THROWS if the legs don't sum to zero.
 * The DB-level deferred trigger also enforces this at commit; we throw early so
 * the failure is observable inside the service-layer try/catch instead of a generic
 * Prisma error.
 */
export async function writeLedgerTxn(
  tx: Prisma.TransactionClient,
  draft: LedgerEntryDraft,
): Promise<{ txnId: string }> {
  if (draft.legs.length < 2) {
    throw new Error('a ledger txn must have at least 2 legs');
  }
  const sum = draft.legs.reduce((acc, l) => acc + l.amountMinor, 0n);
  if (sum !== 0n) {
    throw new Error(`unbalanced ledger txn: sum=${sum.toString()} (must be 0)`);
  }

  const txnId = randomUUID();
  for (const leg of draft.legs) {
    await tx.ledgerEntry.create({
      data: {
        txnId,
        walletId: leg.walletId,
        amountMinor: leg.amountMinor,
        reason: leg.reason,
        refType: leg.refType ?? null,
        refId: leg.refId ?? null,
      },
    });
    // Update the denormalized cache; the ledger itself is source of truth.
    await tx.wallet.update({
      where: { id: leg.walletId },
      data: { balanceMinor: { increment: leg.amountMinor }, version: { increment: 1 } },
    });
  }
  return { txnId };
}

/**
 * Build/look up a wallet. Singleton system wallets (platform_revenue, escrow_holding,
 * payment_gateway_clearing) have user_id = null and a unique (null, kind) constraint;
 * user wallets are keyed by (user_id, kind='user').
 */
export async function ensureWallet(
  tx: Prisma.TransactionClient,
  args: { userId: string | null; kind: 'user' | 'platform_revenue' | 'escrow_holding' | 'payment_gateway_clearing' },
): Promise<{ id: string }> {
  const existing = await tx.wallet.findFirst({
    where: { userId: args.userId, kind: args.kind },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.wallet.create({
    data: { userId: args.userId, kind: args.kind, currency: 'PKR' },
  });
}

/**
 * Reconciliation: recompute every wallet's balance from the ledger entries and
 * return any drift. In production this runs nightly; tests can call it directly to
 * prove the cache and the truth agree.
 */
export async function reconcileWallets(): Promise<
  Array<{ walletId: string; cached: bigint; truth: bigint }>
> {
  const wallets = await prisma.wallet.findMany();
  const drift: Array<{ walletId: string; cached: bigint; truth: bigint }> = [];
  for (const w of wallets) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { walletId: w.id },
      _sum: { amountMinor: true },
    });
    const truth = (agg._sum.amountMinor ?? 0n) as bigint;
    if (truth !== w.balanceMinor) {
      drift.push({ walletId: w.id, cached: w.balanceMinor, truth });
    }
  }
  return drift;
}

// ── High-level money flows ──────────────────────────────────────────────────
// These build the right legs for the canonical scenarios. Each takes a tx so the
// ledger write is inside the caller's transaction (state change + money commit
// together — §1/P3).

/**
 * Employer funds escrow. Money "enters the system" via the payment_gateway_clearing
 * wallet (the bookkeeping mirror of the PSP's holdings on KAFIL's behalf). It's
 * debited by the same amount in the same txn, leaving escrow_holding with the funds
 * and clearing returned to zero. The clearing balance therefore reflects "money
 * in-flight" — prod reconciliation matches it against the PSP statement nightly.
 *
 * Why two legs and not a single credit to escrow: every txn must balance. The
 * clearing wallet stands in for the external PSP — when an actual payment lands,
 * the PSP webhook handler will credit clearing first (`payments` row created),
 * then this helper debits clearing and credits escrow.
 */
export async function fundEscrow(
  tx: Prisma.TransactionClient,
  args: { amountMinor: bigint; refType: string; refId: string },
): Promise<{ txnId: string }> {
  if (args.amountMinor <= 0n) throw new Error('fund amount must be positive');
  const gw = await ensureWallet(tx, { userId: null, kind: 'payment_gateway_clearing' });
  const escrow = await ensureWallet(tx, { userId: null, kind: 'escrow_holding' });
  return writeLedgerTxn(tx, {
    legs: [
      { walletId: gw.id, amountMinor: -args.amountMinor, reason: 'escrow_fund', refType: args.refType, refId: args.refId },
      { walletId: escrow.id, amountMinor: args.amountMinor, reason: 'escrow_fund', refType: args.refType, refId: args.refId },
    ],
  });
}

/** Release escrow at completion: pay worker minus commission; commission to platform. */
export async function releaseEscrow(
  tx: Prisma.TransactionClient,
  args: {
    workerId: string;
    grossMinor: bigint;
    commissionMinor: bigint;
    refType: string;
    refId: string;
  },
): Promise<{ txnId: string }> {
  if (args.grossMinor <= 0n) throw new Error('gross must be positive');
  if (args.commissionMinor < 0n || args.commissionMinor > args.grossMinor) {
    throw new Error('commission must be between 0 and gross');
  }
  const escrow = await ensureWallet(tx, { userId: null, kind: 'escrow_holding' });
  const platform = await ensureWallet(tx, { userId: null, kind: 'platform_revenue' });
  const worker = await ensureWallet(tx, { userId: args.workerId, kind: 'user' });
  const net = args.grossMinor - args.commissionMinor;
  return writeLedgerTxn(tx, {
    legs: [
      // Debit escrow by the gross.
      { walletId: escrow.id, amountMinor: -args.grossMinor, reason: 'escrow_release', refType: args.refType, refId: args.refId },
      // Credit worker net.
      { walletId: worker.id, amountMinor: net, reason: 'escrow_release', refType: args.refType, refId: args.refId },
      // Credit platform commission.
      { walletId: platform.id, amountMinor: args.commissionMinor, reason: 'commission', refType: args.refType, refId: args.refId },
    ],
  });
}

/** Refund the full escrow back to the employer. */
export async function refundEscrow(
  tx: Prisma.TransactionClient,
  args: { employerId: string; amountMinor: bigint; refType: string; refId: string },
): Promise<{ txnId: string }> {
  if (args.amountMinor <= 0n) throw new Error('refund amount must be positive');
  const escrow = await ensureWallet(tx, { userId: null, kind: 'escrow_holding' });
  const employer = await ensureWallet(tx, { userId: args.employerId, kind: 'user' });
  return writeLedgerTxn(tx, {
    legs: [
      { walletId: escrow.id, amountMinor: -args.amountMinor, reason: 'refund', refType: args.refType, refId: args.refId },
      { walletId: employer.id, amountMinor: args.amountMinor, reason: 'refund', refType: args.refType, refId: args.refId },
    ],
  });
}

/**
 * Worker cash-out. Money leaves the worker's wallet toward the PSP: debit the worker
 * wallet, credit payment_gateway_clearing (the bookkeeping mirror of outbound funds
 * the PSP will disburse). Balanced. The caller must have already checked the worker
 * has sufficient balance under a row lock (see payout.service).
 */
export async function payOut(
  tx: Prisma.TransactionClient,
  args: { workerId: string; amountMinor: bigint; refType: string; refId: string },
): Promise<{ txnId: string }> {
  if (args.amountMinor <= 0n) throw new Error('payout amount must be positive');
  const worker = await ensureWallet(tx, { userId: args.workerId, kind: 'user' });
  const gw = await ensureWallet(tx, { userId: null, kind: 'payment_gateway_clearing' });
  return writeLedgerTxn(tx, {
    legs: [
      { walletId: worker.id, amountMinor: -args.amountMinor, reason: 'payout', refType: args.refType, refId: args.refId },
      { walletId: gw.id, amountMinor: args.amountMinor, reason: 'payout', refType: args.refType, refId: args.refId },
    ],
  });
}

/**
 * Reverse a failed payout: the exact inverse of payOut. Money never reached the PSP,
 * so it returns from gateway_clearing back to the worker's wallet, making the worker
 * whole. Used when the disbursement provider rejects/fails after the ledger committed.
 */
export async function reversePayout(
  tx: Prisma.TransactionClient,
  args: { workerId: string; amountMinor: bigint; refType: string; refId: string },
): Promise<{ txnId: string }> {
  if (args.amountMinor <= 0n) throw new Error('reversal amount must be positive');
  const worker = await ensureWallet(tx, { userId: args.workerId, kind: 'user' });
  const gw = await ensureWallet(tx, { userId: null, kind: 'payment_gateway_clearing' });
  return writeLedgerTxn(tx, {
    legs: [
      { walletId: gw.id, amountMinor: -args.amountMinor, reason: 'reversal', refType: args.refType, refId: args.refId },
      { walletId: worker.id, amountMinor: args.amountMinor, reason: 'reversal', refType: args.refType, refId: args.refId },
    ],
  });
}

/** Partial settlement: split escrow between worker and employer. */
export async function partialSettle(
  tx: Prisma.TransactionClient,
  args: {
    workerId: string;
    employerId: string;
    grossMinor: bigint;
    payoutMinor: bigint;
    refundMinor: bigint;
    commissionMinor: bigint;
    refType: string;
    refId: string;
  },
): Promise<{ txnId: string }> {
  if (args.payoutMinor + args.refundMinor + args.commissionMinor !== args.grossMinor) {
    throw new Error('partial settle does not balance against gross');
  }
  const escrow = await ensureWallet(tx, { userId: null, kind: 'escrow_holding' });
  const platform = await ensureWallet(tx, { userId: null, kind: 'platform_revenue' });
  const worker = await ensureWallet(tx, { userId: args.workerId, kind: 'user' });
  const employer = await ensureWallet(tx, { userId: args.employerId, kind: 'user' });
  return writeLedgerTxn(tx, {
    legs: [
      { walletId: escrow.id, amountMinor: -args.grossMinor, reason: 'partial_payout', refType: args.refType, refId: args.refId },
      { walletId: worker.id, amountMinor: args.payoutMinor, reason: 'partial_payout', refType: args.refType, refId: args.refId },
      { walletId: employer.id, amountMinor: args.refundMinor, reason: 'partial_refund', refType: args.refType, refId: args.refId },
      { walletId: platform.id, amountMinor: args.commissionMinor, reason: 'commission', refType: args.refType, refId: args.refId },
    ],
  });
}

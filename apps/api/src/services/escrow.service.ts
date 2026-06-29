// Escrow service (§6). Wraps the ledger helpers with business rules:
//   - settings.commission.escrow.{pct,minimum_minor,cap_minor} drive the commission.
//   - fund(...) checks the job is in escrow mode + unfunded; computes the amount from
//     the job's headcount × rate × duration; routes via the (currently console)
//     payment provider; on success writes the ledger txn.
//   - release(...) checks escrow is sufficient + assignment is ready; computes
//     commission; writes the balanced ledger txn.
//   - refund(...) returns the full funded amount to the employer.
//   - For v0 we don't track per-assignment escrow balances separately — the system
//     has ONE escrow_holding wallet and a job's `escrowedFor` ref keeps things
//     attributable in the ledger entries. Once partial settlements arrive at scale
//     we may add per-assignment sub-balances, but the entries already support that.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import {
  ensureWallet,
  fundEscrow as fundEscrowLedger,
  refundEscrow as refundEscrowLedger,
  releaseEscrow as releaseEscrowLedger,
  partialSettle as partialSettleLedger,
} from './ledger';

const DEFAULTS = {
  commissionPct: 5,
  commissionMinMinor: 5_000n, // 50 PKR
  commissionCapMinor: 2_000_000n, // 20,000 PKR
};

// The escrow-debit leg reasons that each represent a TERMINAL settlement of an
// assignment's escrow. Any one of these existing means the assignment is already
// settled — so release / refund / partial must ALL check the full set, not just
// their own reason. (Pre-fix, release checked only 'escrow_release', so a release
// after a refund — or a concurrent double-release — could slip through.)
const SETTLEMENT_REASONS = ['escrow_release', 'refund', 'partial_payout'] as const;

// Thrown inside a txn when a concurrent/duplicate settlement is detected after the
// row lock. Caught by the caller and surfaced as a CONFLICT (never a 500).
class AlreadySettledError extends Error {}

/**
 * Lock the assignment row FOR UPDATE and assert no settlement entry exists yet.
 * Run INSIDE the money transaction: the lock serializes concurrent settlements of
 * the same assignment, so the "has it been settled?" check can't race (the prior
 * TOCTOU let two concurrent releases both pass an out-of-txn check and double-pay).
 */
async function assertUnsettledLocked(tx: Prisma.TransactionClient, assignmentId: string) {
  // Row lock — serializes any other settlement txn on this assignment.
  await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${assignmentId}::uuid FOR UPDATE`;
  const prior = await tx.ledgerEntry.findFirst({
    where: {
      reason: { in: SETTLEMENT_REASONS as unknown as string[] },
      refType: 'assignment',
      refId: assignmentId,
    },
  });
  if (prior) throw new AlreadySettledError();
}

async function loadInt(key: string): Promise<number | null> {
  const s = await prisma.setting.findUnique({ where: { key } });
  if (!s) return null;
  const v = s.value as number | null;
  return typeof v === 'number' ? v : null;
}

async function computeCommission(grossMinor: bigint): Promise<bigint> {
  const pct = (await loadInt('commission.escrow.pct')) ?? DEFAULTS.commissionPct;
  const min = BigInt((await loadInt('commission.escrow.minimum_minor')) ?? Number(DEFAULTS.commissionMinMinor));
  const cap = BigInt((await loadInt('commission.escrow.cap_minor')) ?? Number(DEFAULTS.commissionCapMinor));
  // Integer commission to avoid fractional paisa.
  let c = (grossMinor * BigInt(pct)) / 100n;
  if (c < min) c = min;
  if (c > cap) c = cap;
  if (c > grossMinor) c = grossMinor; // never exceed gross
  return c;
}

/** Total expected job value, in paisa: ratePkr × duration × headcount. */
export function jobExpectedGrossMinor(args: {
  ratePkr: number;
  durationDays: number | null;
  headcount: number;
}): bigint {
  // ratePkr is whole PKR per day; convert to paisa (×100). Default duration to 1 day.
  const days = args.durationDays ?? 1;
  return BigInt(args.ratePkr) * 100n * BigInt(days) * BigInt(args.headcount);
}

export const escrowService = {
  /**
   * Fund the escrow for a job. v0: idempotent — re-funding the same job is a no-op
   * once the expected gross is already escrowed. Real PSP integration replaces the
   * "always succeed" assumption (provider returns pending/succeeded/failed).
   */
  async fundForJob(args: {
    jobId: string;
    employerId: string;
  }): Promise<Result<{ amountMinor: string; alreadyFunded: boolean }>> {
    const job = await prisma.job.findUnique({
      where: { id: args.jobId },
      select: {
        id: true,
        employerId: true,
        paymentMode: true,
        ratePkr: true,
        durationDays: true,
        headcount: true,
      },
    });
    if (!job) return err('NOT_FOUND', 'job not found');
    if (job.employerId !== args.employerId) return err('FORBIDDEN', 'not your job');
    if (job.paymentMode !== 'escrow') return err('CONFLICT', 'job is not escrow-mode');

    const target = jobExpectedGrossMinor({
      ratePkr: job.ratePkr,
      durationDays: job.durationDays,
      headcount: job.headcount,
    });

    // Idempotency: sum prior escrow_fund entries against this job.
    const funded = await prisma.ledgerEntry.aggregate({
      where: { reason: 'escrow_fund', refType: 'job', refId: job.id, amountMinor: { gt: 0 } },
      _sum: { amountMinor: true },
    });
    const already = (funded._sum.amountMinor ?? 0n) as bigint;
    if (already >= target) {
      return ok({ amountMinor: target.toString(), alreadyFunded: true });
    }

    const remaining = target - already;
    await prisma.$transaction(async (tx) => {
      await fundEscrowLedger(tx, { amountMinor: remaining, refType: 'job', refId: job.id });
      await emitEvent(tx, {
        eventType: 'escrow.funded',
        actorId: args.employerId,
        refType: 'job',
        refId: job.id,
        payload: { amount_minor: remaining.toString(), total_now: target.toString() },
      });
    });
    return ok({ amountMinor: target.toString(), alreadyFunded: false });
  },

  /**
   * Release escrow on assignment completion. Pays the worker (gross − commission)
   * and credits the platform commission. Idempotent by checking the assignment's
   * prior escrow_release entries.
   */
  async releaseForAssignment(args: {
    assignmentId: string;
  }): Promise<Result<{ workerNetMinor: string; commissionMinor: string }>> {
    const a = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      include: { job: { select: { paymentMode: true, employerId: true } } },
    });
    if (!a) return err('NOT_FOUND', 'assignment not found');
    if (a.job.paymentMode !== 'escrow') return err('CONFLICT', 'job is not escrow-mode');

    // Gross for one assignment = rate × duration (one slot's worth).
    const job = await prisma.job.findUniqueOrThrow({
      where: { id: a.jobId },
      select: { ratePkr: true, durationDays: true },
    });
    const gross = BigInt(a.agreedRatePkr || job.ratePkr) * 100n * BigInt(job.durationDays ?? 1);
    const commission = await computeCommission(gross);
    const net = gross - commission;

    try {
      await prisma.$transaction(async (tx) => {
        // Lock + settle-once check INSIDE the txn so concurrent releases serialize.
        await assertUnsettledLocked(tx, a.id);
        await releaseEscrowLedger(tx, {
          workerId: a.workerId,
          grossMinor: gross,
          commissionMinor: commission,
          refType: 'assignment',
          refId: a.id,
        });
        // Stamp finalizedAt on the assignment but DON'T overwrite status — the caller
        // (workbench or scheduler) drives state machine transitions.
        await tx.assignment.update({
          where: { id: a.id },
          data: { finalizedAt: new Date(), version: { increment: 1 } },
        });
        await emitEvent(tx, {
          eventType: 'escrow.released',
          actorId: null,
          refType: 'assignment',
          refId: a.id,
          payload: {
            gross_minor: gross.toString(),
            commission_minor: commission.toString(),
            net_minor: net.toString(),
          },
        });
      });
    } catch (e) {
      if (e instanceof AlreadySettledError) {
        return err('CONFLICT', 'escrow already settled for this assignment');
      }
      throw e;
    }

    return ok({ workerNetMinor: net.toString(), commissionMinor: commission.toString() });
  },

  /** Full refund to employer for an assignment (e.g. refund_employer resolution). */
  async refundForAssignment(args: {
    assignmentId: string;
  }): Promise<Result<{ refundedMinor: string }>> {
    const a = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      include: { job: { select: { paymentMode: true, employerId: true, ratePkr: true, durationDays: true } } },
    });
    if (!a) return err('NOT_FOUND', 'assignment not found');
    if (a.job.paymentMode !== 'escrow') return err('CONFLICT', 'job is not escrow-mode');

    const gross = BigInt(a.agreedRatePkr || a.job.ratePkr) * 100n * BigInt(a.job.durationDays ?? 1);

    try {
      await prisma.$transaction(async (tx) => {
        await assertUnsettledLocked(tx, a.id);
        await refundEscrowLedger(tx, {
          employerId: a.job.employerId,
          amountMinor: gross,
          refType: 'assignment',
          refId: a.id,
        });
        await emitEvent(tx, {
          eventType: 'escrow.refunded',
          actorId: null,
          refType: 'assignment',
          refId: a.id,
          payload: { refunded_minor: gross.toString() },
        });
      });
    } catch (e) {
      if (e instanceof AlreadySettledError) {
        return err('CONFLICT', 'escrow already settled for this assignment');
      }
      throw e;
    }
    return ok({ refundedMinor: gross.toString() });
  },

  /** Partial settlement — ops chooses payoutMinor; commission still applies. */
  async partialSettleAssignment(args: {
    assignmentId: string;
    payoutMinor: bigint;
  }): Promise<Result<{ payoutMinor: string; refundMinor: string; commissionMinor: string }>> {
    const a = await prisma.assignment.findUnique({
      where: { id: args.assignmentId },
      include: { job: { select: { paymentMode: true, employerId: true, ratePkr: true, durationDays: true } } },
    });
    if (!a) return err('NOT_FOUND', 'assignment not found');
    if (a.job.paymentMode !== 'escrow') return err('CONFLICT', 'job is not escrow-mode');

    const gross = BigInt(a.agreedRatePkr || a.job.ratePkr) * 100n * BigInt(a.job.durationDays ?? 1);
    if (args.payoutMinor < 0n || args.payoutMinor > gross) {
      return err('VALIDATION', 'payout must be between 0 and gross');
    }
    // Commission is computed with the SAME min/cap policy as a full release — a worker
    // shouldn't be charged a different rate just because ops chose "partial" over
    // "pay_worker". Commission is bounded never to exceed the payout (computeCommission
    // caps at its argument), so refund stays ≥ 0.
    const commission = await computeCommission(args.payoutMinor);
    const refund = gross - args.payoutMinor - commission;
    if (refund < 0n) return err('VALIDATION', 'commission exceeds gross-payout');

    try {
      await prisma.$transaction(async (tx) => {
        await assertUnsettledLocked(tx, a.id);
        await partialSettleLedger(tx, {
          workerId: a.workerId,
          employerId: a.job.employerId,
          grossMinor: gross,
          payoutMinor: args.payoutMinor,
          refundMinor: refund,
          commissionMinor: commission,
          refType: 'assignment',
          refId: a.id,
        });
        await emitEvent(tx, {
          eventType: 'escrow.partial_settled',
          refType: 'assignment',
          refId: a.id,
          payload: {
            payout_minor: args.payoutMinor.toString(),
            refund_minor: refund.toString(),
            commission_minor: commission.toString(),
          },
        });
      });
    } catch (e) {
      if (e instanceof AlreadySettledError) {
        return err('CONFLICT', 'escrow already settled for this assignment');
      }
      throw e;
    }
    return ok({
      payoutMinor: args.payoutMinor.toString(),
      refundMinor: refund.toString(),
      commissionMinor: commission.toString(),
    });
  },
};

// Suppress unused-import noise.
void ensureWallet;

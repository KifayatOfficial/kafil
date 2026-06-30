// Wallet top-up service (§6). The inbound counterpart to payout.service: a user adds
// money to their KAFIL wallet via a PSP (JazzCash/Easypaisa), which they then spend on
// featured posts (§6.1), verification tiers, or escrow funding.
//
// Same async shape as escrow funding (§6/§26/M3): we create a `pending` Payment, the
// client completes it at the PSP, and the money only lands in the wallet when the
// signed PSP webhook confirms — never on the optimistic client path. We never credit a
// wallet for money we haven't actually received.

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { topUpWallet as topUpLedger } from './ledger';

const MIN_TOPUP_MINOR = 5_000n; // 50 PKR floor — avoid dust top-ups + PSP fee waste.
const MAX_TOPUP_MINOR = 50_000_000n; // 500,000 PKR ceiling — a sane anti-fat-finger cap.

export const walletService = {
  /**
   * Begin a wallet top-up. Creates a `pending` Payment for `amountMinor` and returns its
   * id; the client hands this to the PSP and the wallet is credited only when the PSP
   * confirms via the webhook (completeTopUpForPayment). Idempotent on the supplied key:
   * a retry with the same key returns the existing Payment rather than creating a second.
   */
  async initiateTopUp(args: {
    userId: string;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<Result<{ paymentId: string; amountMinor: string; status: string }>> {
    if (args.amountMinor < MIN_TOPUP_MINOR) {
      return err('VALIDATION', `minimum top-up is ${MIN_TOPUP_MINOR.toString()} paisa`);
    }
    if (args.amountMinor > MAX_TOPUP_MINOR) {
      return err('VALIDATION', `maximum top-up is ${MAX_TOPUP_MINOR.toString()} paisa`);
    }

    // Idempotency: a prior top-up Payment with this key returns the same result.
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });
    if (existing) {
      return ok({
        paymentId: existing.id,
        amountMinor: existing.amountMinor.toString(),
        status: existing.status,
      });
    }

    const payment = await prisma.payment.create({
      data: {
        userId: args.userId,
        amountMinor: args.amountMinor,
        provider: 'pending_psp',
        status: 'pending',
        refType: 'wallet_topup',
        refId: args.userId, // a top-up's "subject" is the user's own wallet
        idempotencyKey: args.idempotencyKey,
      },
    });
    await emitEvent(prisma, {
      eventType: 'wallet.topup_initiated',
      actorId: args.userId,
      refType: 'payment',
      refId: payment.id,
      payload: { amount_minor: args.amountMinor.toString() },
    });
    return ok({ paymentId: payment.id, amountMinor: args.amountMinor.toString(), status: 'pending' });
  },

  /**
   * Complete a confirmed top-up Payment (called by the webhook handler). Marks the
   * Payment succeeded and credits the user's wallet via the ledger, idempotently — a
   * Payment already `succeeded` is a no-op, so a duplicate webhook can't double-credit.
   * State flip + ledger move commit together (P3).
   */
  async completeTopUpForPayment(args: {
    paymentId: string;
    confirmedAmountMinor?: bigint;
  }): Promise<Result<{ creditedMinor: string; alreadyDone: boolean }>> {
    return prisma.$transaction(async (tx) => {
      // Lock the payment row so concurrent webhook deliveries serialize.
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${args.paymentId}::uuid FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id: args.paymentId } });
      if (!payment) return err('NOT_FOUND', 'payment not found');
      if (payment.refType !== 'wallet_topup' || !payment.refId) {
        return err('CONFLICT', 'payment is not a wallet top-up');
      }
      if (payment.status === 'succeeded') {
        return ok({ creditedMinor: '0', alreadyDone: true });
      }
      if (payment.status !== 'pending') {
        return err('CONFLICT', `payment is ${payment.status}, not creditable`);
      }

      const amount = payment.amountMinor as bigint;
      if (args.confirmedAmountMinor != null && args.confirmedAmountMinor !== amount) {
        return err('CONFLICT', 'confirmed amount does not match expected');
      }

      await topUpLedger(tx, {
        userId: payment.userId,
        amountMinor: amount,
        refType: 'payment',
        refId: payment.id,
      });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'succeeded' } });
      await emitEvent(tx, {
        eventType: 'wallet.topped_up',
        actorId: payment.userId,
        refType: 'payment',
        refId: payment.id,
        payload: { amount_minor: amount.toString() },
      });
      return ok({ creditedMinor: amount.toString(), alreadyDone: false });
    });
  },

  /** Mark a top-up Payment failed (PSP reported failure). Idempotent. */
  async failTopUpForPayment(args: { paymentId: string }): Promise<Result<{ ok: true }>> {
    const payment = await prisma.payment.findUnique({ where: { id: args.paymentId } });
    if (!payment) return err('NOT_FOUND', 'payment not found');
    if (payment.status === 'pending') {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
      await emitEvent(prisma, {
        eventType: 'wallet.topup_failed',
        actorId: payment.userId,
        refType: 'payment',
        refId: payment.id,
      });
    }
    return ok({ ok: true });
  },
};

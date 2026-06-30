// PSP webhook ingest (§6 + §26/M3). The async side of the money subsystem: a PSP
// confirms a payment by POSTing a signed callback, which we verify, dedupe, and
// dispatch. This is what makes real escrow funding work — money lands in escrow only
// after the gateway confirms, not on the optimistic synchronous path.
//
// Safety properties:
//   - Signature verified before ANY processing (webhook.provider) — an attacker can't
//     forge "payment succeeded".
//   - Dedupe via WebhookEvent UNIQUE(provider, providerRef, eventType): gateways retry
//     aggressively, so the same event arriving twice must be processed once. The unique
//     insert is the dedupe primitive — a P2002 on insert means "already seen".
//   - The downstream effect (escrow funding) is ALSO idempotent on its own, so even a
//     race that slips past the dedupe can't double-fund.

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { webhookProvider } from '../providers/webhook.provider';
import { escrowService } from './escrow.service';
import { walletService } from './wallet.service';

export const webhookService = {
  /**
   * Ingest one raw webhook delivery. Returns a Result the route maps to HTTP:
   *   - ok({ deduped:true })  — already processed; respond 200 (PSP stops retrying).
   *   - ok({ processed:true }) — handled now.
   *   - err('UNAUTHORIZED')   — bad/missing signature; respond 401 (do NOT process).
   *   - err('VALIDATION')     — malformed; respond 400.
   */
  async ingest(args: {
    rawBody: string;
    signature: string | null;
  }): Promise<Result<{ processed: boolean; deduped: boolean; eventType: string }>> {
    const verified = webhookProvider.verify({ rawBody: args.rawBody, signature: args.signature });
    if (!verified.ok || !verified.event) {
      return err('UNAUTHORIZED', verified.reason ?? 'signature verification failed');
    }
    const ev = verified.event;
    const payloadHash = createHash('sha256').update(args.rawBody).digest('hex');

    // Dedupe: try to claim this (provider, providerRef, eventType). If the row already
    // exists, this is a retry → no-op success.
    let parsedPayload: Prisma.InputJsonValue;
    try {
      parsedPayload = JSON.parse(args.rawBody) as Prisma.InputJsonValue;
    } catch {
      parsedPayload = {};
    }
    // Dedupe claim. We try to insert the WebhookEvent row FIRST (P2002 = already seen),
    // but we only treat a prior row as a true dedupe if it was actually PROCESSED. A row
    // left unprocessed by a previous crashed/failed attempt is re-driven here — this is
    // what prevents the "stuck funds" bug where the claim commits but the dispatch then
    // throws, leaving escrow unfunded while the PSP got a 200.
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: ev.provider,
          providerRef: ev.providerRef,
          eventType: ev.eventType,
          payloadHash,
          payload: parsedPayload,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const prior = await prisma.webhookEvent.findUnique({
          where: {
            provider_providerRef_eventType: {
              provider: ev.provider,
              providerRef: ev.providerRef,
              eventType: ev.eventType,
            },
          },
          select: { processedAt: true },
        });
        // Already fully processed → genuine dedupe. Otherwise fall through and re-drive.
        if (prior?.processedAt) {
          return ok({ processed: false, deduped: true, eventType: ev.eventType });
        }
      } else {
        throw e;
      }
    }

    // Dispatch. Downstream effects are independently idempotent (defense in depth), so
    // re-driving an unprocessed event can't double-fund. Any throw is caught and
    // surfaced as INTERNAL so the route returns 5xx and the PSP retries — and crucially
    // we DON'T stamp processedAt, so the retry re-drives instead of being deduped away.
    let result = 'ignored';
    let dispatchErr: string | null = null;
    try {
      if (ev.eventType === 'payment.succeeded' && ev.paymentId) {
        // One payment.succeeded event services both money inflows; we route by the
        // Payment's refType so a top-up credits the wallet and a job funding fills escrow.
        const kind = await paymentKind(ev.paymentId);
        if (kind === 'wallet_topup') {
          const r = await walletService.completeTopUpForPayment({
            paymentId: ev.paymentId,
            confirmedAmountMinor: ev.amountMinor != null ? BigInt(ev.amountMinor) : undefined,
          });
          result = r.ok ? 'topped_up' : `error:${r.code}`;
          if (!r.ok) dispatchErr = `${r.code}:${r.message}`;
        } else {
          const r = await escrowService.completeFundingForPayment({
            paymentId: ev.paymentId,
            confirmedAmountMinor: ev.amountMinor != null ? BigInt(ev.amountMinor) : undefined,
          });
          result = r.ok ? 'funded' : `error:${r.code}`;
          if (!r.ok) dispatchErr = `${r.code}:${r.message}`;
        }
      } else if (ev.eventType === 'payment.failed' && ev.paymentId) {
        const kind = await paymentKind(ev.paymentId);
        const r =
          kind === 'wallet_topup'
            ? await walletService.failTopUpForPayment({ paymentId: ev.paymentId })
            : await escrowService.failFundingForPayment({ paymentId: ev.paymentId });
        result = r.ok ? 'failed' : `error:${r.code}`;
        if (!r.ok) dispatchErr = `${r.code}:${r.message}`;
      }
    } catch (e) {
      // Leave processedAt NULL so the PSP retry re-drives this exact event.
      // eslint-disable-next-line no-console
      console.error('[webhook] dispatch threw:', e instanceof Error ? e.message : String(e));
      return err('INTERNAL', 'webhook dispatch failed; will retry');
    }
    // A NOT_FOUND/transient dispatch error also stays un-stamped so the PSP retries
    // (the Payment row may not be visible yet under read-after-write lag).
    if (dispatchErr && result.startsWith('error:NOT_FOUND')) {
      return err('INTERNAL', `dispatch not ready: ${dispatchErr}`);
    }

    // Mark processed only after a successful (or terminally-handled) dispatch.
    await prisma.webhookEvent.updateMany({
      where: { provider: ev.provider, providerRef: ev.providerRef, eventType: ev.eventType },
      data: { processedAt: new Date(), result },
    });
    await emitEvent(prisma, {
      eventType: 'webhook.processed',
      refType: 'payment',
      refId: ev.paymentId ?? null,
      payload: { provider: ev.provider, event_type: ev.eventType, result },
    });

    return ok({ processed: true, deduped: false, eventType: ev.eventType });
  },
};

/** The Payment's refType ('wallet_topup' | 'job' | …), used to route a confirmation. */
async function paymentKind(paymentId: string): Promise<string | null> {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { refType: true },
  });
  return p?.refType ?? null;
}

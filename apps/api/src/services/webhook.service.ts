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
        return ok({ processed: false, deduped: true, eventType: ev.eventType });
      }
      throw e;
    }

    // Dispatch. Downstream effects are independently idempotent (defense in depth).
    let result = 'ignored';
    if (ev.eventType === 'payment.succeeded' && ev.paymentId) {
      const r = await escrowService.completeFundingForPayment({
        paymentId: ev.paymentId,
        confirmedAmountMinor: ev.amountMinor != null ? BigInt(ev.amountMinor) : undefined,
      });
      result = r.ok ? 'funded' : `error:${r.code}`;
    } else if (ev.eventType === 'payment.failed' && ev.paymentId) {
      const r = await escrowService.failFundingForPayment({ paymentId: ev.paymentId });
      result = r.ok ? 'failed' : `error:${r.code}`;
    }

    // Record the outcome on the WebhookEvent row.
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

// §6/§2.9 + §26/M3 — PSP webhook verification behind a swappable interface.
//
// Real PSPs (JazzCash / Easypaisa) confirm payments ASYNCHRONOUSLY by POSTing a signed
// callback. The server must (1) verify the signature so an attacker can't forge a
// "payment succeeded", and (2) parse the provider's payload into a normalized event.
// Dev/test uses an HMAC-SHA256 scheme over the raw body; prod swaps in the real
// provider's signature algorithm without touching the webhook service.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Normalized webhook event the rest of the system understands. */
export interface NormalizedWebhookEvent {
  provider: string;
  /** The PSP's reference for the underlying payment/transaction (idempotency anchor). */
  providerRef: string;
  /** 'payment.succeeded' | 'payment.failed' (normalized across providers). */
  eventType: string;
  /** Confirmed amount in paisa, as a string (precision-safe). Present on success. */
  amountMinor?: string;
  /** The Payment.id we created at initiate time, echoed back by the PSP in metadata. */
  paymentId?: string;
}

export interface WebhookVerifyResult {
  ok: boolean;
  event?: NormalizedWebhookEvent;
  reason?: string;
}

export interface WebhookProvider {
  /** Verify the signature over the raw body and parse into a normalized event. */
  verify(args: { rawBody: string; signature: string | null }): WebhookVerifyResult;
}

const SECRET = process.env.PSP_WEBHOOK_SECRET ?? 'dev-only-webhook-secret-DO-NOT-USE-IN-PROD';

/**
 * Dev/test provider. Signature = base64url(HMAC-SHA256(rawBody, secret)). Body is JSON:
 *   { provider, provider_ref, event_type, amount_minor?, payment_id? }
 */
class HmacWebhookProvider implements WebhookProvider {
  verify(args: { rawBody: string; signature: string | null }): WebhookVerifyResult {
    if (!args.signature) return { ok: false, reason: 'missing signature' };
    const expected = createHmac('sha256', SECRET).update(args.rawBody).digest('base64url');
    const a = Buffer.from(args.signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad signature' };
    }
    let parsed: {
      provider?: string;
      provider_ref?: string;
      event_type?: string;
      amount_minor?: string | number;
      payment_id?: string;
    };
    try {
      parsed = JSON.parse(args.rawBody);
    } catch {
      return { ok: false, reason: 'invalid json' };
    }
    if (!parsed.provider || !parsed.provider_ref || !parsed.event_type) {
      return { ok: false, reason: 'missing required fields' };
    }
    return {
      ok: true,
      event: {
        provider: parsed.provider,
        providerRef: parsed.provider_ref,
        eventType: parsed.event_type,
        amountMinor: parsed.amount_minor != null ? String(parsed.amount_minor) : undefined,
        paymentId: parsed.payment_id,
      },
    };
  }
}

let active: WebhookProvider = new HmacWebhookProvider();

export const webhookProvider: WebhookProvider = {
  verify: (args) => active.verify(args),
};

/** Install a provider (prod startup / tests). Returns the previous one. */
export function setWebhookProvider(p: WebhookProvider): WebhookProvider {
  const prev = active;
  active = p;
  return prev;
}

/** Test/dev helper: sign a raw body with the dev HMAC scheme. */
export function signWebhookBody(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('base64url');
}

// POST /api/webhooks/payments — PSP payment-confirmation callback (§6 + §26/M3).
//
// No bearer auth: the caller is the payment gateway, not a user. Authenticity is
// established by the signature header (verified in webhook.service). We read the RAW
// body (not req.json()) because the signature is computed over the exact bytes.
import { NextResponse } from 'next/server';
import { webhookService } from '../../../../services/webhook.service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  // Common header names across PSPs; dev/test uses x-kafil-signature.
  const signature =
    req.headers.get('x-kafil-signature') ??
    req.headers.get('x-signature') ??
    req.headers.get('x-jazzcash-signature') ??
    null;

  const res = await webhookService.ingest({ rawBody, signature });
  if (!res.ok) {
    // 401 → forged/misconfigured signature (PSP should NOT retry).
    // 5xx → dispatch failed/not-ready: return 503 so the PSP DOES retry and we re-drive.
    // 400 → malformed.
    const status =
      res.code === 'UNAUTHORIZED' ? 401 : res.code === 'INTERNAL' ? 503 : 400;
    return NextResponse.json({ ok: false, code: res.code, message: res.message }, { status });
  }
  // Always 200 on a verified event (including dedupe) so the gateway stops retrying.
  return NextResponse.json({ ok: true, ...res.value });
}

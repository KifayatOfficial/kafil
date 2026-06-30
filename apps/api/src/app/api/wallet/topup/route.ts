// POST /api/wallet/topup — begin a wallet top-up. Creates a `pending` Payment for the
// requested amount; the client completes it at the PSP and the wallet is credited when
// the signed PSP webhook confirms (production) or via the dev-confirm route (local).
// Body: { amount_minor, idempotency_key }.
import { NextResponse } from 'next/server';
import { walletService } from '../../../../services/wallet.service';
import { idempotent } from '../../../../lib/idempotency';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub, moneyScopeBlocked } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  // §24/A1 — money actions are blocked during the SIM-swap cooldown window.
  if (moneyScopeBlocked(actor)) {
    return NextResponse.json(
      { ok: false, code: 'FORBIDDEN', message: 'money actions are paused on this device' },
      { status: 403 },
    );
  }

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const body = (await req.json()) as { amount_minor?: number | string };
  const amount = typeof body.amount_minor === 'string' ? Number(body.amount_minor) : body.amount_minor;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'amount_minor must be a positive number' },
      { status: 400 },
    );
  }

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/wallet/topup',
    key,
    requestBody: { amount },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await walletService.initiateTopUp({
    userId: actor.userId,
    amountMinor: BigInt(Math.trunc(amount)),
    idempotencyKey: key,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

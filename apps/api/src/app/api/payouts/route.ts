// POST /api/payouts — worker requests a cash-out from their wallet (§6).
import { NextResponse } from 'next/server';
import { getActorOrDevStub, moneyScopeBlocked } from '../../../lib/auth';
import { payoutService } from '../../../services/payout.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  // §24/A1 — SIM-swap cooldown sessions cannot move money out.
  if (moneyScopeBlocked(actor)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Money actions are temporarily disabled after a device change. Try again later.',
      },
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
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // amount_minor on the wire is a non-negative integer string (paisa).
  const raw = body.amount_minor;
  let amountMinor: bigint;
  try {
    if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('missing');
    amountMinor = BigInt(raw);
  } catch {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'amount_minor (paisa, integer string) required' },
      { status: 400 },
    );
  }
  if (amountMinor <= 0n) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'amount_minor must be positive' },
      { status: 400 },
    );
  }

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/payouts',
    key,
    requestBody: { amount_minor: amountMinor.toString() },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await payoutService.requestPayout({
    workerId: actor.userId,
    amountMinor,
    idempotencyKey: key,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

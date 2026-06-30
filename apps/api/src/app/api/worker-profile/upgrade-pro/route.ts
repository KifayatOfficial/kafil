// POST /api/worker-profile/upgrade-pro — buy/extend the worker "Pro" tier (§6.1).
// Charged from the worker's wallet → platform_revenue; extends proUntil by a month.
import { NextResponse } from 'next/server';
import { monetizationService } from '../../../../services/monetization.service';
import { idempotent } from '../../../../lib/idempotency';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub, moneyScopeBlocked } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  // §24/A1 — going Pro moves money, so it's blocked during the SIM-swap cooldown.
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

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/worker-profile/upgrade-pro',
    key,
    requestBody: {},
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await monetizationService.upgradeWorkerPro({ workerId: actor.userId });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

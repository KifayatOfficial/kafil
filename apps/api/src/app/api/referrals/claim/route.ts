// POST /api/referrals/claim — a not-yet-referred user claims a referral code.
// Reward is NOT paid here (§10 F7): the claim is `pending` until the referred user
// completes their first job. Body: { code, device_fingerprint?, idempotency_key }.
import { NextResponse } from 'next/server';
import { referralService } from '../../../../services/referral.service';
import { idempotent } from '../../../../lib/idempotency';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const body = (await req.json()) as { code?: string; device_fingerprint?: string };

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/referrals/claim',
    key,
    requestBody: body,
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await referralService.claim({
    referredUserId: actor.userId,
    code: body.code ?? '',
    deviceFingerprint: body.device_fingerprint ?? null,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

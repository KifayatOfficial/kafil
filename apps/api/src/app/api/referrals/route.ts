// GET /api/referrals — the caller's referral dashboard (code + claims + total earned).
// The shareable code is created lazily on first GET.
import { NextResponse } from 'next/server';
import { referralService } from '../../../services/referral.service';
import { statusFor } from '../../../lib/result';
import { getActorOrDevStub } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  // Ensure the user has a shareable code, then return the dashboard.
  const codeRes = await referralService.getOrCreateMyCode(actor.userId);
  if (!codeRes.ok) return NextResponse.json(codeRes, { status: statusFor(codeRes.code) });

  const res = await referralService.listMine(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, ...res.value });
}

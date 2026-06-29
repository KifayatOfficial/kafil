// GET /api/wallet — the caller's wallet balance + recent payouts (§6).
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../lib/auth';
import { payoutService } from '../../../services/payout.service';
import { statusFor } from '../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const res = await payoutService.getWallet(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, wallet: res.value });
}

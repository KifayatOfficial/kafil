// POST /api/wallet/topup/confirm — DEV-ONLY simulation of the PSP confirmation.
//
// In production the wallet is credited by the signed PSP webhook (webhook.service →
// walletService.completeTopUpForPayment). Until that integration is live, this lets the
// app exercise the full top-up loop locally. It is hard-disabled in production so it can
// never be used to mint balance. Body: { payment_id }.
import { NextResponse } from 'next/server';
import { walletService } from '../../../../../services/wallet.service';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';
import { prisma } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: 'not available' }, { status: 403 });
  }
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const body = (await req.json()) as { payment_id?: string };
  if (!body.payment_id) {
    return NextResponse.json({ ok: false, code: 'VALIDATION', message: 'payment_id required' }, { status: 400 });
  }

  // Authorization: only the user who owns the pending Payment can confirm it (dev too).
  const payment = await prisma.payment.findUnique({
    where: { id: body.payment_id },
    select: { userId: true },
  });
  if (!payment) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  if (payment.userId !== actor.userId) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const res = await walletService.completeTopUpForPayment({ paymentId: body.payment_id });
  return NextResponse.json(res, { status: res.ok ? 200 : statusFor(res.code) });
}

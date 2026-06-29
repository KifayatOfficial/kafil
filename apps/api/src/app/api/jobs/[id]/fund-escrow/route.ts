// POST /api/jobs/:id/fund-escrow — employer funds the job's escrow.
//
// v0: this writes the ledger entry directly via the manual provider model. When the
// real JazzCash/Easypaisa integration lands, this endpoint becomes a thin shim that
// hands off to the PSP and the webhook handler writes the ledger; idempotency
// remains the contract.
import { NextResponse } from 'next/server';
import { escrowService } from '../../../../../services/escrow.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub, moneyScopeBlocked } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  // §24/A1 — a session in SIM-swap cooldown (scope.money=false) cannot move money.
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
  const { id } = await ctx.params;
  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/jobs/:id/fund-escrow',
    key,
    requestBody: { jobId: id },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await escrowService.fundForJob({ jobId: id, employerId: actor.userId });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

// POST /api/jobs/:id/feature — employer pays to boost their job to the top of the feed
// for 24h (§6.1). Charged from the employer's wallet → platform_revenue.
import { NextResponse } from 'next/server';
import { monetizationService } from '../../../../../services/monetization.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub, moneyScopeBlocked } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  // §24/A1 — featuring moves money, so it's blocked during the SIM-swap cooldown.
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
  const { id: jobId } = await ctx.params;

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/jobs/:id/feature',
    key,
    requestBody: { jobId },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await monetizationService.featureJob({ jobId, employerId: actor.userId });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

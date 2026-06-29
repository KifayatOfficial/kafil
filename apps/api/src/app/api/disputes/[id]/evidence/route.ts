// POST /api/disputes/:id/evidence — a party attaches evidence to an open dispute.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../../lib/auth';
import { disputeService } from '../../../../../services/dispute.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const { id: disputeId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/disputes/:id/evidence',
    key,
    requestBody: { disputeId, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await disputeService.addEvidence({
    actorId: actor.userId,
    disputeId,
    input: { ...body, idempotency_key: key },
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

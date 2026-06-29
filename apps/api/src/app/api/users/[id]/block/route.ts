// POST   /api/users/:id/block   — block user :id (§25.9 / F11).
// DELETE /api/users/:id/block   — unblock user :id.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../../lib/auth';
import { safetyService } from '../../../../../services/safety.service';
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
  const { id: blockedId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = { ...body, blocked_id: blockedId, idempotency_key: key };

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/users/:id/block',
    key,
    requestBody: { blockedId, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await safetyService.blockUser({ userId: actor.userId, input });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const { id: blockedId } = await ctx.params;
  const res = await safetyService.unblockUser({ userId: actor.userId, blockedId });
  return NextResponse.json(res, { status: res.ok ? 200 : statusFor(res.code) });
}

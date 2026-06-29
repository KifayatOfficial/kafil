// POST /api/admin/users/:id/moderate — moderator ban / suspend / lift / warn (§9).
// Moderator-only. Body: { verb, reason, expires_at?, idempotency_key }.
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/admin-auth';
import { safetyService } from '../../../../../../services/safety.service';
import { idempotent } from '../../../../../../lib/idempotency';
import { statusFor } from '../../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'unauthorized') return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  if (auth.kind === 'forbidden') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const { id: targetUserId } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const guard = await idempotent({
    userId: auth.userId,
    endpoint: 'POST /api/admin/users/:id/moderate',
    key,
    requestBody: { targetUserId, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await safetyService.moderateUser({
    actorId: auth.userId,
    targetUserId,
    input: { ...body, idempotency_key: key },
  });
  const status = res.ok ? 200 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

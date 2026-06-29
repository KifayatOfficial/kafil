// POST /api/reports — one-tap report on any entity (§9). Any authenticated user.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../lib/auth';
import { safetyService } from '../../../services/safety.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const body = (await req.json()) as Record<string, unknown>;

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/reports',
    key,
    requestBody: body,
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await safetyService.reportEntity({ reporterId: actor.userId, input: body });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

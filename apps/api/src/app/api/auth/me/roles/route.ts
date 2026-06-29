// POST /api/auth/me/roles — lazy add (§3). Adding an existing role is idempotent.
import { NextResponse } from 'next/server';
import { getActor } from '../../../../../lib/auth';
import { userService } from '../../../../../services/user.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = getActor(req);
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
    endpoint: 'POST /api/auth/me/roles',
    key,
    requestBody: body,
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await userService.addRole({ userId: actor.userId, input: body });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

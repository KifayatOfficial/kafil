// GET  /api/groups        — community group directory (with the caller's join flags).
// POST /api/groups        — create a group (creator auto-joins as admin).
import { NextResponse } from 'next/server';
import { communityService } from '../../../services/community.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';
import { getActorOrDevStub } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? undefined;
  const res = await communityService.listGroups({ userId: actor.userId, category });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, groups: res.value });
}

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const body = (await req.json()) as { name?: string; description?: string; category?: string; location_id?: string };
  const guard = await idempotent({ userId: actor.userId, endpoint: 'POST /api/groups', key, requestBody: body });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await communityService.createGroup({
    creatorId: actor.userId,
    name: body.name ?? '',
    description: body.description,
    category: body.category,
    locationId: body.location_id,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

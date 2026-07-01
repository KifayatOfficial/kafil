// GET  /api/shops  — shop directory (optional ?category=). Public to authed users.
// POST /api/shops  — create a shop (owner = caller).
import { NextResponse } from 'next/server';
import { shopService } from '../../../services/shop.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';
import { getActorOrDevStub } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? undefined;
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const res = await shopService.listShops({
    category,
    cursor,
    limit: limitParam ? Number.parseInt(limitParam, 10) : undefined,
  });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, shops: res.value.items, nextCursor: res.value.nextCursor });
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
  const body = (await req.json()) as { name?: string; description?: string; categories?: string[]; location_id?: string; photos?: string[] };
  const guard = await idempotent({ userId: actor.userId, endpoint: 'POST /api/shops', key, requestBody: body });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await shopService.createShop({
    ownerId: actor.userId,
    name: body.name ?? '',
    description: body.description,
    categories: body.categories,
    locationId: body.location_id,
    photos: body.photos,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

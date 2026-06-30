// GET   /api/shops/:id — shop detail (profile + recent reviews).
// PATCH /api/shops/:id — owner edits name/description/categories/photos.
import { NextResponse } from 'next/server';
import { shopService } from '../../../../services/shop.service';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await shopService.getShop(id);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, shop: res.value });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string; description?: string; categories?: string[]; photos?: string[] };
  const res = await shopService.updateShop({ shopId: id, ownerId: actor.userId, ...body });
  return NextResponse.json(res, { status: res.ok ? 200 : statusFor(res.code) });
}

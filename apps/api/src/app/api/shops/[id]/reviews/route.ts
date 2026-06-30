// POST /api/shops/:id/reviews — leave/update a shop review (1 per customer).
import { NextResponse } from 'next/server';
import { shopService } from '../../../../../services/shop.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

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
  const { id } = await ctx.params;
  const body = (await req.json()) as { rating?: number; comment?: string };
  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/shops/:id/reviews',
    key,
    requestBody: { shopId: id, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await shopService.reviewShop({
    shopId: id,
    authorId: actor.userId,
    rating: body.rating ?? 0,
    comment: body.comment,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

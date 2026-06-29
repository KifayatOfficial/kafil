// POST /api/assignments/:id/reviews — submit a review.
// GET  /api/assignments/:id/reviews — list visible reviews.
import { NextResponse } from 'next/server';
import { reviewService } from '../../../../../services/review.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Require auth: reviews are profile-shaping data, not anonymously enumerable by id.
  const actor = getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await ctx.params;
  const res = await reviewService.listForAssignment(id);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, reviews: res.value });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const { id: assignmentId } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/assignments/:id/reviews',
    key,
    requestBody: { assignmentId, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await reviewService.submit({
    actorId: actor.userId,
    assignmentId,
    input: body,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

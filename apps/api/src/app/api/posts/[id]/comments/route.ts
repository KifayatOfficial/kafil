// GET  /api/posts/:id/comments — visible comments on a post (oldest first).
// POST /api/posts/:id/comments — comment (members only; body PII-redacted).
import { NextResponse } from 'next/server';
import { communityService } from '../../../../../services/community.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await communityService.listComments({ postId: id });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, comments: res.value });
}

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
  const body = (await req.json()) as { body?: string };
  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/posts/:id/comments',
    key,
    requestBody: { postId: id, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await communityService.createComment({
    postId: id,
    authorId: actor.userId,
    body: body.body ?? '',
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

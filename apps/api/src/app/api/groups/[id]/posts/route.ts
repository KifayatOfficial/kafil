// GET  /api/groups/:id/posts — visible posts in a group (pinned first).
// POST /api/groups/:id/posts — create a post (members only; body PII-redacted).
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
  const res = await communityService.listPosts({ groupId: id });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, posts: res.value });
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
  const body = (await req.json()) as { body?: string; kind?: string; images?: string[] };
  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/groups/:id/posts',
    key,
    requestBody: { groupId: id, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await communityService.createPost({
    groupId: id,
    authorId: actor.userId,
    body: body.body ?? '',
    kind: body.kind,
    images: body.images,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

// GET  /api/conversations/:id/messages — list visible messages (redacted-only).
// POST /api/conversations/:id/messages — send a message (PII redacted server-side).
import { NextResponse } from 'next/server';
import { getActor, getActorOrDevStub } from '../../../../../lib/auth';
import { chatService } from '../../../../../services/chat.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Read accepts the dev-stub so the desktop shell can view a thread in dev; sending
  // (POST below) stays strict. chatService still gates on participation either way.
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await chatService.listMessages({ conversationId: id, userId: actor.userId });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, messages: res.value });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/conversations/:id/messages',
    key,
    requestBody: { conversationId: id, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await chatService.sendMessage({
    conversationId: id,
    senderId: actor.userId,
    input: body,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

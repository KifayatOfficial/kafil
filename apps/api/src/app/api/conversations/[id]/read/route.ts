// POST /api/conversations/:id/read — mark the thread read up to now for the caller.
// Called when a user opens a conversation; zeroes its unread contribution to the badge.
//
// No Idempotency-Key required: the op is inherently idempotent (it stamps lastReadAt =
// now; replaying only moves the cursor forward, never corrupts state). Accepts the
// dev-stub so the desktop shell can mark-read while browsing; chatService still gates on
// participation, so a stranger gets FORBIDDEN.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../../lib/auth';
import { chatService } from '../../../../../services/chat.service';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await chatService.markRead({ conversationId: id, userId: actor.userId });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true });
}

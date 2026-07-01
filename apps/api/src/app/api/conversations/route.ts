// GET /api/conversations — list the caller's conversations.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../lib/auth';
import { chatService } from '../../../services/chat.service';
import { statusFor } from '../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Read accepts the dev-stub (x-user-id) so the desktop shell can browse in dev; the
  // stub is a no-op in production. Writes stay on strict getActor.
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const res = await chatService.listConversations(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, conversations: res.value });
}

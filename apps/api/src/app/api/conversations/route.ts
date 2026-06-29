// GET /api/conversations — list the caller's conversations.
import { NextResponse } from 'next/server';
import { getActor } from '../../../lib/auth';
import { chatService } from '../../../services/chat.service';
import { statusFor } from '../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = getActor(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const res = await chatService.listConversations(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, conversations: res.value });
}

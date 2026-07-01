// GET /api/conversations/unread-count — total unread messages for the caller.
// Powers the live chat badge on the bottom-tab Portal (§27/1.2). Cheap single grouped
// query; clients re-poll on a `message.new` SSE hint rather than on a timer.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../lib/auth';
import { chatService } from '../../../../services/chat.service';
import { statusFor } from '../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Read accepts the dev-stub so the desktop shell can show a badge in dev; the stub is a
  // no-op in production. The count is scoped to the caller either way.
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const res = await chatService.unreadTotal(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, total: res.value.total });
}

// GET /api/notifications/unread-count — unread total for the inbox badge (§11 read side).
// Cheap count over @@index([userId, readAt]); the client re-polls on a notification SSE
// hint (or on inbox open) rather than on a timer.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../lib/auth';
import { notificationInboxService } from '../../../../services/notification-inbox.service';
import { statusFor } from '../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const res = await notificationInboxService.unreadCount(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, total: res.value.total });
}

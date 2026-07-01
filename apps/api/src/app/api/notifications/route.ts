// GET /api/notifications — the caller's in-app inbox, keyset-paginated (§11 read side).
// ?cursor=<token>&limit=<n>; nextCursor is null at the end. Newest first.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../lib/auth';
import { notificationInboxService } from '../../../services/notification-inbox.service';
import { statusFor } from '../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const res = await notificationInboxService.list({
    userId: actor.userId,
    cursor,
    limit: limitParam ? Number.parseInt(limitParam, 10) : undefined,
  });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, notifications: res.value.items, nextCursor: res.value.nextCursor });
}

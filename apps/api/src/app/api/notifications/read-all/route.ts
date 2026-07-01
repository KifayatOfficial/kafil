// POST /api/notifications/read-all — mark every unread notification read (§11 read side).
// Inherently idempotent (no Idempotency-Key needed): re-running only flips rows still
// unread, so a replay is a 0-row no-op. Returns how many were flipped.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../lib/auth';
import { notificationInboxService } from '../../../../services/notification-inbox.service';
import { statusFor } from '../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const res = await notificationInboxService.markAllRead(actor.userId);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, updated: res.value.updated });
}

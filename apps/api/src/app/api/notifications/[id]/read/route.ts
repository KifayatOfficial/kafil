// POST /api/notifications/:id/read — mark one notification read (§11 read side).
// Scoped to the caller: reading someone else's id (or a missing one) flips 0 rows and
// returns updated:false — never leaks whether the id exists. Inherently idempotent.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../../lib/auth';
import { notificationInboxService } from '../../../../../services/notification-inbox.service';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await notificationInboxService.markRead({ userId: actor.userId, id });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, updated: res.value.updated });
}

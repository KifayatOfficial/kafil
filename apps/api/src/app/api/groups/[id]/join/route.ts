// POST   /api/groups/:id/join  — join a community group (idempotent).
// DELETE /api/groups/:id/join  — leave it.
import { NextResponse } from 'next/server';
import { communityService } from '../../../../../services/community.service';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await communityService.join({ groupId: id, userId: actor.userId });
  return NextResponse.json(res, { status: res.ok ? 201 : statusFor(res.code) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await communityService.leave({ groupId: id, userId: actor.userId });
  return NextResponse.json(res, { status: res.ok ? 200 : statusFor(res.code) });
}

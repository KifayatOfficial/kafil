// GET /api/users/:id — public profile (PII-masked; see userService.getPublicProfile).
import { NextResponse } from 'next/server';
import { userService } from '../../../../services/user.service';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await userService.getPublicProfile(id);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, user: res.value });
}

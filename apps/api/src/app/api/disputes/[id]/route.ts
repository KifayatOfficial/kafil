// GET /api/disputes/:id — a party views their dispute + evidence.
import { NextResponse } from 'next/server';
import { getActorOrDevStub } from '../../../../lib/auth';
import { disputeService } from '../../../../services/dispute.service';
import { statusFor } from '../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await ctx.params;
  const res = await disputeService.getForParty({ actorId: actor.userId, disputeId: id });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, dispute: res.value });
}

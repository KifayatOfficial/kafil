// GET /api/admin/workbench/:assignmentId — full case timeline for ops.
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { workbenchService } from '../../../../../services/workbench.service';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ assignmentId: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'unauthorized') return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  if (auth.kind === 'forbidden') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });

  const { assignmentId } = await ctx.params;
  const res = await workbenchService.getCase({ assignmentId });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, ...res.value });
}

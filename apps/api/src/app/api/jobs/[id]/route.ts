import { NextResponse } from 'next/server';
import { jobService } from '../../../../services/job.service';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Require auth: job detail carries the exact location pin (§12) — never anonymous.
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await ctx.params;
  const res = await jobService.getJob(id);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, job: res.value });
}

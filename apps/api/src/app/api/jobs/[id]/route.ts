import { NextResponse } from 'next/server';
import { jobService } from '../../../../services/job.service';
import { statusFor } from '../../../../lib/result';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await jobService.getJob(id);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, job: res.value });
}

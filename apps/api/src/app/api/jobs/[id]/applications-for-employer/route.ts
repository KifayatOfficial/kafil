// GET /api/jobs/:id/applications-for-employer — applicants for one of MY jobs.
// Returns 403 if the job isn't owned by the caller (privacy).
import { NextResponse } from 'next/server';
import { applicationRepository } from '../../../../../repositories/application.repository';
import { prisma } from '../../../../../lib/db';
import { getActor } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, employerId: true },
  });
  if (!job) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  if (job.employerId !== actor.userId) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const applications = await applicationRepository.listForJob(id);
  return NextResponse.json({ ok: true, applications });
}

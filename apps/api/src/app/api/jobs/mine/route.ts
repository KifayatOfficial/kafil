// GET /api/jobs/mine — the calling employer's posted jobs.
import { NextResponse } from 'next/server';
import { listRepository } from '../../../../repositories/list.repository';
import { getActor } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const jobs = await listRepository.jobsForEmployer(actor.userId);
  return NextResponse.json({ ok: true, jobs });
}

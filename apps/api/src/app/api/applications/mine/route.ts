// GET /api/applications/mine — the calling worker's applications.
import { NextResponse } from 'next/server';
import { applicationRepository } from '../../../../repositories/application.repository';
import { getActor } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const applications = await applicationRepository.listForWorker(actor.userId);
  return NextResponse.json({ ok: true, applications });
}

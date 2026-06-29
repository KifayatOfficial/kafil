import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { getActor } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    include: { roles: true, workerProfile: true, employerProfile: true },
  });
  if (!user) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ ok: true, user });
}

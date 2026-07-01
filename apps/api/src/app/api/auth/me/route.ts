import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Read accepts the dev-stub (x-user-id) so the desktop shell can show a profile in dev;
  // the stub is a no-op in production.
  const actor = await getActorOrDevStub(req);
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

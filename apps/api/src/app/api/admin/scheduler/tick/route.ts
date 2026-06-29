// POST /api/admin/scheduler/tick — manual fire of the scheduler.
// Admin-only. Returns the stats so an ops UI can show "1 expired, 3 routed".
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { schedulerService } from '../../../../../services/scheduler.service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'unauthorized') return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  if (auth.kind === 'forbidden') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });

  const stats = await schedulerService.tickOnce();
  return NextResponse.json({ ok: true, stats });
}

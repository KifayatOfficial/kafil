// GET /api/admin/reports — the reports ops queue, grouped by target (§18).
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-auth';
import { safetyService } from '../../../../services/safety.service';
import { statusFor } from '../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'unauthorized') return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  if (auth.kind === 'forbidden') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });

  const res = await safetyService.listReportsQueue();
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, items: res.value });
}

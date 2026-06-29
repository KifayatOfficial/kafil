// POST /api/admin/reports/resolve — resolve all open reports against one target.
// Body: { target_type, target_id, decision: 'dismiss'|'action', note?, ban? }.
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { safetyService } from '../../../../../services/safety.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'unauthorized') return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  if (auth.kind === 'forbidden') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });

  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const targetType = typeof body.target_type === 'string' ? body.target_type : '';
  const targetId = typeof body.target_id === 'string' ? body.target_id : '';
  const decision = body.decision === 'action' ? 'action' : 'dismiss';
  if (!targetType || !targetId) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'target_type and target_id are required' },
      { status: 400 },
    );
  }

  const guard = await idempotent({
    userId: auth.userId,
    endpoint: 'POST /api/admin/reports/resolve',
    key,
    requestBody: { targetType, targetId, decision, ban: body.ban === true },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await safetyService.resolveReports({
    actorId: auth.userId,
    targetType,
    targetId,
    decision,
    note: typeof body.note === 'string' ? body.note : undefined,
    ban: body.ban === true,
  });
  const status = res.ok ? 200 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

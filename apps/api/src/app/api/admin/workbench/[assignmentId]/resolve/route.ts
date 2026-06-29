// POST /api/admin/workbench/:assignmentId/resolve — apply a resolution.
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/admin-auth';
import { workbenchService } from '../../../../../../services/workbench.service';
import { idempotent } from '../../../../../../lib/idempotency';
import { statusFor } from '../../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ assignmentId: string }> }) {
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
  const { assignmentId } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const guard = await idempotent({
    userId: auth.userId,
    endpoint: 'POST /api/admin/workbench/:id/resolve',
    key,
    requestBody: { assignmentId, ...body },
  });
  if (guard.replay) return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });

  const res = await workbenchService.resolve({
    actorId: auth.userId,
    assignmentId,
    disputeId: typeof body.dispute_id === 'string' ? body.dispute_id : undefined,
    input: body,
  });
  const status = res.ok ? 200 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

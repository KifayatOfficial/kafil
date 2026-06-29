// POST /api/jobs/:id/applications — worker applies to a job.
import { NextResponse } from 'next/server';
import { applicationService } from '../../../../../services/application.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = getActorOrDevStub(req);
  if (!actor) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }
  const { id: jobId } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/jobs/:id/applications',
    key,
    requestBody: { jobId, ...body },
  });
  if (guard.replay) {
    return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });
  }

  const res = await applicationService.apply({
    workerId: actor.userId,
    jobId,
    input: body,
  });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

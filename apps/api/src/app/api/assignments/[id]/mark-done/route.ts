// POST /api/assignments/:id/mark-done — either side marks the assignment done.
// §26/M1 — evidence (photos, geo, chat ack) gets attached here and used by the scheduler
// later to decide auto-complete vs. awaiting_ops_review.
import { NextResponse } from 'next/server';
import { MarkDoneInput } from '@kafil/core';
import { prisma } from '../../../../../lib/db';
import { assignmentService } from '../../../../../services/assignment.service';
import { idempotent } from '../../../../../lib/idempotency';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
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
  const { id: assignmentId } = await ctx.params;
  const body = await req.json();
  const parsed = MarkDoneInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const guard = await idempotent({
    userId: actor.userId,
    endpoint: 'POST /api/assignments/:id/mark-done',
    key,
    requestBody: { assignmentId, ...parsed.data },
  });
  if (guard.replay) {
    return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });
  }

  // Decide which side is acting.
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { workerId: true, jobId: true, job: { select: { employerId: true } } },
  });
  if (!a) {
    const res = { ok: false as const, code: 'NOT_FOUND' as const, message: 'assignment' };
    await guard.store(404, res);
    return NextResponse.json(res, { status: 404 });
  }
  const isWorker = a.workerId === actor.userId;
  const isEmployer = a.job.employerId === actor.userId;
  if (!isWorker && !isEmployer) {
    const res = { ok: false as const, code: 'FORBIDDEN' as const, message: 'not your assignment' };
    await guard.store(403, res);
    return NextResponse.json(res, { status: 403 });
  }

  const res = await assignmentService.transition({
    assignmentId,
    name: isWorker ? 'worker_mark_done' : 'employer_mark_done',
    actorId: actor.userId,
    by: isWorker ? 'worker' : 'employer',
    payload: { photo_urls: parsed.data.photo_urls, geo: parsed.data.geo },
  });
  const status = res.ok ? 200 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

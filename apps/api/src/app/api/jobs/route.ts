// POST /api/jobs — create a job (employer-side).
// GET  /api/jobs — list open jobs.
// Route handlers are THIN: parse → call service → translate Result → respond. (P2)

import { NextResponse } from 'next/server';
import { jobService } from '../../../services/job.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';
import { getActorOrDevStub } from '../../../lib/auth';

export async function GET() {
  const res = await jobService.listOpen();
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, jobs: res.value });
}

export async function POST(req: Request) {
  // §24/A7 — accept Idempotency-Key header.
  const key = req.headers.get('idempotency-key');
  if (!key) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }

  const actor = await getActorOrDevStub(req);
  if (!actor) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'Authorization: Bearer <token> required' },
      { status: 401 },
    );
  }
  const employerId = actor.userId;

  const body = await req.json();
  const guard = await idempotent({
    userId: employerId,
    endpoint: 'POST /api/jobs',
    key,
    requestBody: body,
  });
  if (guard.replay) {
    return NextResponse.json(guard.cached.body, { status: guard.cached.statusCode });
  }

  const res = await jobService.createJob({ employerId, input: body });
  const status = res.ok ? 201 : statusFor(res.code);
  await guard.store(status, res);
  return NextResponse.json(res, { status });
}

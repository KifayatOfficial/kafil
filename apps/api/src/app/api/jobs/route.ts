// POST /api/jobs — create a job (employer-side).
// GET  /api/jobs — list open jobs.
// Route handlers are THIN: parse → call service → translate Result → respond. (P2)

import { NextResponse } from 'next/server';
import { jobService } from '../../../services/job.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';

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

  // TEMP: auth not wired yet — accept X-User-Id header for early dev only.
  // Real auth in apps/api/src/lib/auth.ts (Tier-B follow-up).
  const employerId = req.headers.get('x-user-id');
  if (!employerId) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'X-User-Id header required (dev stub)' },
      { status: 401 },
    );
  }

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

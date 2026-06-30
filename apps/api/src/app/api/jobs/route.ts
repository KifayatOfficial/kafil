// POST /api/jobs — create a job (employer-side).
// GET  /api/jobs — list open jobs.
// Route handlers are THIN: parse → call service → translate Result → respond. (P2)

import { NextResponse } from 'next/server';
import { jobService } from '../../../services/job.service';
import { matchingService } from '../../../services/matching.service';
import { idempotent } from '../../../lib/idempotency';
import { statusFor } from '../../../lib/result';
import { getActorOrDevStub } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/jobs — the worker's feed.
//   • Authenticated worker WITH a base location → §8 geo-ranked feed (nearest + best
//     match first), with a per-job "why" breakdown. `ranked: true` tells the client.
//   • Otherwise (anonymous dev stub, or worker without a location yet) → the plain
//     date-ordered open list, so the app still works before onboarding completes.
export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (actor?.userId) {
    const ranked = await matchingService.rankedJobsForWorker({ workerId: actor.userId });
    if (ranked.ok && ranked.value.located) {
      return NextResponse.json({ ok: true, ranked: true, jobs: ranked.value.jobs });
    }
  }
  // §P1.4 — plain feed is keyset-paginated: ?cursor=<token>&limit=<n>. nextCursor is null
  // at the end of the feed. (The ranked branch above returns its own scored slice.)
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const res = await jobService.listOpen({
    cursor,
    limit: limitParam ? Number.parseInt(limitParam, 10) : undefined,
  });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, ranked: false, jobs: res.value.items, nextCursor: res.value.nextCursor });
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

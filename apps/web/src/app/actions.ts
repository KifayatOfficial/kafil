'use server';

// Next server actions — the web shell's write path. They run on the web SERVER (never
// the browser), POST to the API with the dev-stub actor + a generated Idempotency-Key
// (P4), then revalidate the affected page so the new row shows immediately.
//
// Only endpoints that accept the dev stub are wired here (jobs, groups, group posts,
// join). Chat-send stays mobile-only — it requires a real authenticated participant.

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const DEV_EMPLOYER = process.env.WEB_DEV_USER_ID ?? '00000000-0000-0000-0000-000000000010';
const DEV_WORKER = '00000000-0000-0000-0000-000000000020';
// Seeded demo values so the forms work out of the box (see seed scripts).
const DEMO_LOCATION = '00000000-0000-0000-0000-000000000001';
const DEMO_SPECIALTY = '01f8d7be-e937-4cd8-b80b-557c26ae494a'; // Mason

export interface ActionResult {
  ok: boolean;
  message?: string;
}

async function post(path: string, body: Record<string, unknown>, asUser: string): Promise<ActionResult> {
  try {
    const key = randomUUID();
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': asUser,
        'idempotency-key': key,
      },
      // Some endpoints validate idempotency_key IN THE BODY (e.g. CreateJobInput), others
      // only read the header. Send both so every write path is satisfied.
      body: JSON.stringify({ idempotency_key: key, ...body }),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; code?: string };
    if (!res.ok || data.ok === false) {
      return { ok: false, message: data.message ?? data.code ?? `Failed (${res.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' };
  }
}

// ── Jobs ────────────────────────────────────────────────────────────────
export async function postJobAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const title = String(form.get('title') ?? '').trim();
  const rate = Number.parseInt(String(form.get('rate') ?? ''), 10);
  const description = String(form.get('description') ?? '').trim();
  if (title.length < 3) return { ok: false, message: 'Title must be at least 3 characters.' };
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false, message: 'Enter a valid daily rate.' };

  const r = await post(
    '/api/jobs',
    {
      title,
      description: description || undefined,
      location_id: DEMO_LOCATION,
      headcount: 1,
      rate_pkr: rate,
      rate_unit: 'day',
      payment_mode: 'cash',
      specialty_ids: [DEMO_SPECIALTY],
    },
    DEV_EMPLOYER,
  );
  if (r.ok) revalidatePath('/');
  return r.ok ? { ok: true, message: 'Job posted.' } : r;
}

// ── Community: create group ───────────────────────────────────────────────
export async function createGroupAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const name = String(form.get('name') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const category = String(form.get('category') ?? 'general');
  if (name.length < 3) return { ok: false, message: 'Group name must be at least 3 characters.' };

  const r = await post('/api/groups', { name, description: description || undefined, category }, DEV_WORKER);
  if (r.ok) revalidatePath('/community');
  return r.ok ? { ok: true, message: 'Group created.' } : r;
}

// ── Community: post in a group ────────────────────────────────────────────
export async function createPostAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const groupId = String(form.get('groupId') ?? '');
  const body = String(form.get('body') ?? '').trim();
  const kind = String(form.get('kind') ?? 'discussion');
  if (!groupId) return { ok: false, message: 'Missing group.' };
  if (body.length < 1) return { ok: false, message: 'Write something to post.' };

  const r = await post(`/api/groups/${groupId}/posts`, { body, kind }, DEV_WORKER);
  if (r.ok) revalidatePath(`/community/${groupId}`);
  return r.ok ? { ok: true, message: 'Posted.' } : r;
}

// ── Community: join a group ───────────────────────────────────────────────
export async function joinGroupAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const groupId = String(form.get('groupId') ?? '');
  if (!groupId) return { ok: false, message: 'Missing group.' };
  const r = await post(`/api/groups/${groupId}/join`, {}, DEV_WORKER);
  if (r.ok) revalidatePath('/community');
  return r.ok ? { ok: true, message: 'Joined.' } : r;
}

// ── Jobs: apply (as the demo worker) ──────────────────────────────────────
export async function applyToJobAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const jobId = String(form.get('jobId') ?? '');
  const message = String(form.get('message') ?? '').trim();
  const rate = Number.parseInt(String(form.get('rate') ?? ''), 10);
  if (!jobId) return { ok: false, message: 'Missing job.' };
  const body: Record<string, unknown> = {};
  if (message) body.message = message;
  if (Number.isFinite(rate) && rate > 0) body.proposed_rate_pkr = rate;

  const r = await post(`/api/jobs/${jobId}/applications`, body, DEV_WORKER);
  if (r.ok) revalidatePath(`/job/${jobId}`);
  return r.ok ? { ok: true, message: 'Application sent.' } : r;
}

// ── Shops: write a review (as the demo worker/customer) ───────────────────
export async function submitReviewAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const shopId = String(form.get('shopId') ?? '');
  const rating = Number.parseInt(String(form.get('rating') ?? ''), 10);
  const comment = String(form.get('comment') ?? '').trim();
  if (!shopId) return { ok: false, message: 'Missing shop.' };
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, message: 'Pick a rating 1–5.' };

  const r = await post(`/api/shops/${shopId}/reviews`, { rating, comment: comment || undefined }, DEV_WORKER);
  if (r.ok) revalidatePath(`/shops/${shopId}`);
  return r.ok ? { ok: true, message: 'Review submitted.' } : r;
}

// Server-side API fetch for the web dashboard's pages (server components).
//
// The community/directory endpoints use getActorOrDevStub — outside production they
// accept an `x-user-id` header as a dev actor. The admin/desktop shell isn't a real
// signed-in KAFIL user, so we pass the seeded demo user's id to read the same data the
// mobile app sees. (Real admin auth — a scoped token — lands with the workbench auth
// pass; until then this keeps the shell useful in dev.)

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const DEV_USER = process.env.WEB_DEV_USER_ID ?? '00000000-0000-0000-0000-000000000010';

// The seeded demo users. Employer owns shops + is in the seeded chat; worker holds the
// worker profile. Pages pick whichever fits what they're showing.
export const DEMO_EMPLOYER = '00000000-0000-0000-0000-000000000010';
export const DEMO_WORKER = '00000000-0000-0000-0000-000000000020';

/** GET a path and return the parsed JSON object (or null on any failure). */
export async function fetchJson<T = Record<string, unknown>>(
  path: string,
  asUser: string = DEV_USER,
): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { 'x-user-id': asUser },
      ...({ cache: 'no-store' } as RequestInit),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET a list endpoint and return the named array (e.g. 'shops', 'groups', 'jobs'). */
export async function fetchList<T>(path: string, key: string, asUser: string = DEV_USER): Promise<T[]> {
  const data = await fetchJson<Record<string, unknown>>(path, asUser);
  return data ? ((data[key] as T[]) ?? []) : [];
}

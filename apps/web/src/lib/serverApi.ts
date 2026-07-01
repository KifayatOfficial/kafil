// Server-side API fetch for the web dashboard's pages (server components).
//
// The community/directory endpoints use getActorOrDevStub — outside production they
// accept an `x-user-id` header as a dev actor. The admin/desktop shell isn't a real
// signed-in KAFIL user, so we pass the seeded demo user's id to read the same data the
// mobile app sees. (Real admin auth — a scoped token — lands with the workbench auth
// pass; until then this keeps the shell useful in dev.)

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const DEV_USER = process.env.WEB_DEV_USER_ID ?? '00000000-0000-0000-0000-000000000010';

/** GET a list endpoint and return the named array (e.g. 'shops', 'groups', 'jobs'). */
export async function fetchList<T>(path: string, key: string): Promise<T[]> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { 'x-user-id': DEV_USER },
      // no-store: the shell always shows current data.
      ...({ cache: 'no-store' } as RequestInit),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, unknown>;
    return (data[key] as T[]) ?? [];
  } catch {
    // API down / unreachable → empty; the page renders its empty state, never crashes.
    return [];
  }
}

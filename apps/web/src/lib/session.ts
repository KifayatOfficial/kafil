// Web session — the real per-user auth for the desktop shell.
//
// The user does the same OTP → token flow the mobile app does; the resulting access
// token is stored in an httpOnly cookie (not readable by JS, so XSS can't exfiltrate it).
// Server components + server actions read it here and send it as `Bearer` to the API,
// acting as the real user. When there's no cookie, callers fall back to the dev-stub so
// anonymous browsing still works in dev.

import { cookies } from 'next/headers';

export const AUTH_COOKIE = 'kafil.session';

/** The current user's access token from the httpOnly cookie, or null if signed out. */
export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(AUTH_COOKIE)?.value ?? null;
}

/**
 * Auth header for an API call:
 *  - real user signed in  → Authorization: Bearer <token>
 *  - otherwise (dev)      → x-user-id dev stub, so browsing still works
 * Pass a devUser to control which stub identity is used when signed out.
 */
export async function apiAuthHeaders(devUser: string): Promise<Record<string, string>> {
  const token = await getSessionToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return { 'x-user-id': devUser };
}

/** True when a real user (not the dev stub) is signed in. */
export async function isSignedIn(): Promise<boolean> {
  return (await getSessionToken()) != null;
}

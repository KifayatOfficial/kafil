// Web session — real per-user auth for the desktop shell, with refresh-token rotation.
//
// Two httpOnly cookies: a short-lived ACCESS token (Bearer on API calls) and a long-lived
// REFRESH token. When an API call 401s (access expired), authedFetch transparently calls
// the API's /api/auth/refresh — which ROTATES the refresh token (old one dies) — writes
// the new pair back to the cookies, and retries once. So a web session survives the
// ~15-min access-token TTL without the user re-logging in.

import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'kafil.session'; // kept name for back-compat with existing cookie
export const REFRESH_COOKIE = 'kafil.refresh';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ACCESS_MAX_AGE = 60 * 30; // 30 min (access token is ~15m; a little slack)
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function setSessionTokens(access: string, refresh?: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, access, cookieOpts(ACCESS_MAX_AGE));
  if (refresh) jar.set(REFRESH_COOKIE, refresh, cookieOpts(REFRESH_MAX_AGE));
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  return !!(jar.get(ACCESS_COOKIE)?.value || jar.get(REFRESH_COOKIE)?.value);
}

// Coalesce concurrent refreshes. The API's refresh token is single-use with reuse
// detection: if two parallel requests both present the SAME (rotated-out) token, the
// second trips reuse-detection and REVOKES the whole session. Server components render
// in parallel, so we dedupe by the presented refresh token — a burst of 401s shares one
// refresh call instead of racing (and self-revoking).
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Use the refresh cookie to mint a fresh access token (rotating the refresh token) and
 * persist both. Returns the new access token, or null if refresh is unavailable/expired
 * (caller should treat that as signed-out). Best-effort — never throws.
 */
export async function tryRefresh(): Promise<string | null> {
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;

  const existing = inFlight.get(refresh);
  if (existing) return existing;

  const run = (async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; value?: { accessToken: string; refreshToken: string } };
      if (!res.ok || !data.value?.accessToken) {
        // Refresh failed (rotated-out / revoked) → clear so the UI shows signed-out.
        await clearSession();
        return null;
      }
      await setSessionTokens(data.value.accessToken, data.value.refreshToken);
      return data.value.accessToken;
    } catch {
      return null;
    } finally {
      inFlight.delete(refresh);
    }
  })();

  inFlight.set(refresh, run);
  return run;
}

/**
 * fetch() that attaches the current access token and, on a 401, refreshes once and
 * retries. Returns the Response. When signed out, sends no auth (caller adds a dev stub).
 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();
  const withAuth = (t: string | null): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    cache: 'no-store',
  });
  let res = await fetch(`${API_URL}${path}`, withAuth(token));
  if (res.status === 401 && token) {
    const fresh = await tryRefresh();
    if (fresh) res = await fetch(`${API_URL}${path}`, withAuth(fresh));
  }
  return res;
}

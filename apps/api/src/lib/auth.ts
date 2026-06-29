// Auth helper used by route handlers. Reads Authorization: Bearer <token>.
//
// Beyond signature+expiry (verifyAccessToken), an access token is only honoured if
// its SESSION is still live: a revoked session (logout, ban, security incident) must
// invalidate every outstanding access token immediately, not wait for the 15-min
// access-token TTL. We therefore look the session up on each authed request. To bound
// the per-request DB cost we cache the session's (revokedAt, scope) for a few seconds —
// short enough that a revocation takes effect almost immediately, long enough to
// absorb bursty request patterns from one client.

import type { NextRequest } from 'next/server';
import { prisma } from './db';
import { verifyAccessToken } from '../services/auth.service';

export interface Actor {
  userId: string;
  sessionId: string | null;
  /** Session scope (§24/A1). `money:false` during the SIM-swap cooldown window. */
  scope: { money?: boolean; cooldown_until?: number } | null;
}

// sessionId → { revoked, scope, cachedAt }. Process-local; fine because a stale entry
// only delays a revocation by SESSION_CACHE_TTL_MS, and re-auth is cheap.
const sessionCache = new Map<
  string,
  { revoked: boolean; scope: Actor['scope']; cachedAt: number }
>();
const SESSION_CACHE_TTL_MS = 5_000;

async function loadSession(
  sessionId: string,
): Promise<{ revoked: boolean; scope: Actor['scope'] } | null> {
  const now = Date.now();
  const hit = sessionCache.get(sessionId);
  if (hit && now - hit.cachedAt < SESSION_CACHE_TTL_MS) {
    return { revoked: hit.revoked, scope: hit.scope };
  }
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, scope: true },
  });
  if (!session) {
    // Unknown session id in a validly-signed token → treat as revoked.
    sessionCache.set(sessionId, { revoked: true, scope: null, cachedAt: now });
    return { revoked: true, scope: null };
  }
  const scope = (session.scope as Actor['scope']) ?? null;
  const revoked = session.revokedAt != null;
  sessionCache.set(sessionId, { revoked, scope, cachedAt: now });
  return { revoked, scope };
}

/** Test/admin hook: drop a session from the cache so a revocation is seen at once. */
export function invalidateSessionCache(sessionId?: string): void {
  if (sessionId) sessionCache.delete(sessionId);
  else sessionCache.clear();
}

/**
 * Resolve the authenticated actor from a Bearer token. Returns null if the token is
 * missing/invalid/expired OR its session has been revoked.
 */
export async function getActor(req: Request | NextRequest): Promise<Actor | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  const claims = verifyAccessToken(token);
  if (!claims) return null;

  const session = await loadSession(claims.sessionId);
  if (!session || session.revoked) return null;

  return { userId: claims.userId, sessionId: claims.sessionId, scope: session.scope };
}

/**
 * Backwards-compatible dev variant: accepts an X-User-Id header for smoke-testing
 * when NOT in production. Real tokens still get the full revocation+scope treatment;
 * the dev stub carries no session, so it has no scope restriction.
 */
export async function getActorOrDevStub(req: Request | NextRequest): Promise<Actor | null> {
  const real = await getActor(req);
  if (real) return real;
  const dev = req.headers.get('x-user-id');
  if (dev && process.env.NODE_ENV !== 'production') {
    return { userId: dev, sessionId: null, scope: null };
  }
  return null;
}

/**
 * §24/A1 — money guard. True when the actor's session is in the SIM-swap cooldown
 * (`scope.money === false`) and must be blocked from money-moving endpoints. The dev
 * stub (scope null) and normal sessions (scope null or money!==false) are allowed.
 */
export function moneyScopeBlocked(actor: Actor): boolean {
  return actor.scope?.money === false;
}

// Auth helper used by route handlers. Reads Authorization: Bearer <token>.
// Returns the userId+sessionId or null. Route layer decides what to do with null.

import type { NextRequest } from 'next/server';
import { verifyAccessToken } from '../services/auth.service';

export function getActor(
  req: Request | NextRequest,
): { userId: string; sessionId: string } | null {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return verifyAccessToken(token);
}

/**
 * Backwards-compatible: in early dev some endpoints accept an X-User-Id header for
 * smoke-testing. This will be removed once all clients use real tokens.
 */
export function getActorOrDevStub(
  req: Request | NextRequest,
): { userId: string; sessionId: string | null } | null {
  const real = getActor(req);
  if (real) return real;
  const dev = req.headers.get('x-user-id');
  if (dev && process.env.NODE_ENV !== 'production') {
    return { userId: dev, sessionId: null };
  }
  return null;
}

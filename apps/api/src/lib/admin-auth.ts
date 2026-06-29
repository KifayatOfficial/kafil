// Admin authorization helper. A user is "admin" iff they hold the 'admin' or
// 'moderator' or 'support' role in user_roles. v0 treats all three as equivalent for
// access to the workbench; finer-grained scopes are a follow-up.
//
// Three failure modes returned distinctly:
//   - null  →  no token / invalid token (401 from caller)
//   - 'forbidden' → token valid but user lacks role (403 from caller)
//   - admin actor object → proceed
//
// Service code stays unchanged: route handlers consume this once and pass the userId
// to services as before (services don't know about HTTP or roles).

import type { NextRequest } from 'next/server';
import { prisma } from './db';
import { getActor } from './auth';

const ADMIN_ROLES = new Set(['admin', 'moderator', 'support']);

export type AdminAuthResult =
  | { kind: 'ok'; userId: string; sessionId: string; roles: string[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' };

export async function requireAdmin(req: Request | NextRequest): Promise<AdminAuthResult> {
  const actor = await getActor(req);
  if (!actor || !actor.sessionId) return { kind: 'unauthorized' };

  const roles = await prisma.userRole.findMany({
    where: { userId: actor.userId },
    select: { role: true },
  });
  const has = roles.some((r) => ADMIN_ROLES.has(r.role));
  if (!has) return { kind: 'forbidden' };

  return { kind: 'ok', userId: actor.userId, sessionId: actor.sessionId, roles: roles.map((r) => r.role) };
}

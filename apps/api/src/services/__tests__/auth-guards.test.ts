// Auth-guard regression tests (audit wave 2). These pin two fixes:
//   1. A revoked session invalidates its access tokens immediately (not after TTL).
//   2. The §24/A1 SIM-swap cooldown scope {money:false} is actually ENFORCED, not
//      just returned to the client — moneyScopeBlocked() flags it.
//
// We drive lib/auth directly with a real signed token + a real session row, building
// a plain Request with the Authorization header (no HTTP server needed).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { signAccessToken } from '../auth.service';
import { getActor, moneyScopeBlocked, invalidateSessionCache } from '../../lib/auth';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
  invalidateSessionCache(); // don't let a prior test's cached session leak in
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

function bearer(token: string): Request {
  return new Request('http://test/local', { headers: { authorization: `Bearer ${token}` } });
}

async function sessionFor(userId: string, scope?: object) {
  return prisma.session.create({
    data: { userId, refreshTokenHash: `hash-${userId}-${Math.random()}`, scope: scope ?? undefined },
  });
}

describe('session revocation enforcement (audit #session)', () => {
  it('a live session resolves; revoking it rejects the same token immediately', async () => {
    const user = await makeUser({ role: 'worker' });
    const session = await sessionFor(user.id);
    const token = signAccessToken({ userId: user.id, sessionId: session.id });

    const before = await getActor(bearer(token));
    expect(before?.userId).toBe(user.id);

    // Revoke + clear the short-TTL cache (the cache only delays visibility by 5s).
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    invalidateSessionCache(session.id);

    const after = await getActor(bearer(token));
    expect(after).toBeNull();
  });

  it('a validly-signed token for a non-existent session is rejected', async () => {
    const user = await makeUser({ role: 'worker' });
    const token = signAccessToken({
      userId: user.id,
      sessionId: '00000000-0000-0000-0000-0000000000aa',
    });
    expect(await getActor(bearer(token))).toBeNull();
  });

  it('a garbage / unsigned token is rejected', async () => {
    expect(await getActor(bearer('not.a.token'))).toBeNull();
    expect(await getActor(new Request('http://test/local'))).toBeNull();
  });
});

describe('SIM-swap money-scope enforcement (audit #cooldown)', () => {
  it('a normal session is not money-blocked', async () => {
    const user = await makeUser({ role: 'employer' });
    const session = await sessionFor(user.id); // no scope
    const token = signAccessToken({ userId: user.id, sessionId: session.id });
    const actor = await getActor(bearer(token));
    expect(actor).not.toBeNull();
    expect(moneyScopeBlocked(actor!)).toBe(false);
  });

  it('a cooldown session (scope.money=false) IS money-blocked', async () => {
    const user = await makeUser({ role: 'employer' });
    const session = await sessionFor(user.id, {
      money: false,
      cooldown_until: 9_999_999_999_999,
    });
    const token = signAccessToken({ userId: user.id, sessionId: session.id });
    const actor = await getActor(bearer(token));
    expect(actor).not.toBeNull();
    expect(actor!.scope?.money).toBe(false);
    expect(moneyScopeBlocked(actor!)).toBe(true);
  });
});

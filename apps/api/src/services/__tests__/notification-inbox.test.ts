// Integration tests for the notification READ side (§11). Real Postgres.
//
// Invariants:
// 1. list returns only the caller's notifications, newest first.
// 2. unreadCount counts readAt IS NULL only, scoped to the caller.
// 3. markRead flips exactly one (own) notification; other-user ids are a 0-row no-op.
// 4. markAllRead flips every unread and returns the count.
// 5. list is keyset-paginated (cursor walks the full set with no dupes/gaps).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { notificationsService } from '../notifications.service';
import { notificationInboxService } from '../notification-inbox.service';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

/** Assert the unreadCount call succeeded and return the total (keeps tsc's union narrowed). */
async function unreadOf(userId: string): Promise<number> {
  const r = await notificationInboxService.unreadCount(userId);
  if (!r.ok) throw new Error(`unreadCount failed: ${r.code}`);
  return r.value.total;
}

/** Queue N in-app notifications for a user via the real send() pipeline. */
async function seedNotifs(userId: string, n: number, type = 'test.ping') {
  for (let i = 0; i < n; i++) {
    await notificationsService.send({
      userId,
      type,
      priority: 'engagement', // in-app only — no push token in tests
      title: `n${i}`,
      body: `body ${i}`,
    });
  }
}

describe('§11 notification inbox — read side', () => {
  it('list returns only the caller notifications, newest first', async () => {
    const me = await makeUser({ role: 'worker' });
    const other = await makeUser({ role: 'worker' });
    await seedNotifs(me.id, 3);
    await seedNotifs(other.id, 2);

    const res = await notificationInboxService.list({ userId: me.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items).toHaveLength(3);
    // All mine.
    expect(res.value.items.every((n) => n.type === 'test.ping')).toBe(true);
    // Newest first: created n0..n2, so title order should be n2, n1, n0.
    expect(res.value.items.map((n) => n.title)).toEqual(['n2', 'n1', 'n0']);
  });

  it('unreadCount counts unread only, scoped to the caller', async () => {
    const me = await makeUser({ role: 'worker' });
    const other = await makeUser({ role: 'worker' });
    await seedNotifs(me.id, 4);
    await seedNotifs(other.id, 5);

    expect((await notificationInboxService.unreadCount(me.id)).ok).toBe(true);
    const before = await notificationInboxService.unreadCount(me.id);
    expect(before.ok && before.value.total).toBe(4);

    // Reading one drops the count by one; the other user is untouched.
    const list = await notificationInboxService.list({ userId: me.id });
    if (!list.ok) throw new Error('list failed');
    await notificationInboxService.markRead({ userId: me.id, id: list.value.items[0]!.id });

    const after = await notificationInboxService.unreadCount(me.id);
    expect(after.ok && after.value.total).toBe(3);
    const otherCount = await notificationInboxService.unreadCount(other.id);
    expect(otherCount.ok && otherCount.value.total).toBe(5);
  });

  it('markRead flips one own notification; another user cannot read it', async () => {
    const me = await makeUser({ role: 'worker' });
    const stranger = await makeUser({ role: 'worker' });
    await seedNotifs(me.id, 1);
    const list = await notificationInboxService.list({ userId: me.id });
    if (!list.ok) throw new Error('list failed');
    const id = list.value.items[0]!.id;

    // A stranger targeting my id flips nothing.
    const strangerAttempt = await notificationInboxService.markRead({ userId: stranger.id, id });
    expect(strangerAttempt.ok && strangerAttempt.value.updated).toBe(false);
    expect(await unreadOf(me.id)).toBe(1);

    // I can read my own; a second read is an idempotent 0-row no-op.
    const mine = await notificationInboxService.markRead({ userId: me.id, id });
    expect(mine.ok && mine.value.updated).toBe(true);
    const again = await notificationInboxService.markRead({ userId: me.id, id });
    expect(again.ok && again.value.updated).toBe(false);
  });

  it('markAllRead flips every unread and returns the count', async () => {
    const me = await makeUser({ role: 'worker' });
    await seedNotifs(me.id, 5);
    const res = await notificationInboxService.markAllRead(me.id);
    expect(res.ok && res.value.updated).toBe(5);
    expect(await unreadOf(me.id)).toBe(0);
    // Idempotent: a second call flips nothing.
    const again = await notificationInboxService.markAllRead(me.id);
    expect(again.ok && again.value.updated).toBe(0);
  });

  it('list is keyset-paginated: cursor walks the whole set with no dupes or gaps', async () => {
    const me = await makeUser({ role: 'worker' });
    await seedNotifs(me.id, 25);

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await notificationInboxService.list({ userId: me.id, cursor, limit: 10 });
      if (!res.ok) throw new Error('list failed');
      for (const n of res.value.items) {
        expect(seen.has(n.id)).toBe(false); // no dupes across pages
        seen.add(n.id);
      }
      cursor = res.value.nextCursor;
      pages++;
      expect(pages).toBeLessThanOrEqual(5); // 25/10 = 3 pages; guard against a loop
    } while (cursor);

    expect(seen.size).toBe(25); // no gaps — every row visited exactly once
    expect(pages).toBe(3);
  });
});

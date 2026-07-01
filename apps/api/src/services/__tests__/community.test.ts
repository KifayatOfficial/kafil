// §2.8 / v1.0 §4 community tests. Real Postgres.
//
// Invariants:
//  1. Creating a group auto-joins the creator as admin.
//  2. Posting/commenting requires membership (non-members are FORBIDDEN).
//  3. Posts list pinned-first then newest; comments bump the post's commentCount.
//  4. PII in a post body is redacted before storage (§5) + raises a fraud signal.
//  5. listGroups reports the caller's join flags + member counts.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { communityService } from '../community.service';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

async function makeGroup(creatorId: string, name = 'Mingora Masons') {
  const r = await communityService.createGroup({ creatorId, name, category: 'trade' });
  if (!r.ok) throw new Error('createGroup failed');
  return r.value.groupId;
}

describe('community — groups & membership', () => {
  it('auto-joins the creator as admin', async () => {
    const u = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(u.id);
    const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: u.id } } });
    expect(m?.role).toBe('admin');
  });

  it('keyset-paginates the group directory: every group once, no dupes', async () => {
    const owner = await makeUser({ role: 'employer' });
    for (let i = 0; i < 5; i++) await makeGroup(owner.id, `Group ${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await communityService.listGroups({ userId: owner.id, cursor, limit: 2 });
      if (!res.ok) throw new Error('listGroups failed');
      seen.push(...res.value.items.map((g) => g.id));
      cursor = res.value.nextCursor;
      if (++pages > 10) throw new Error('did not terminate');
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(pages).toBe(3); // 2 + 2 + 1
  });

  it('lists groups with member counts and the caller join flag', async () => {
    const owner = await makeUser({ role: 'employer' });
    const other = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);

    // owner sees joined:true; other sees joined:false until they join.
    const ownerView = await communityService.listGroups({ userId: owner.id });
    expect(ownerView.ok).toBe(true);
    if (ownerView.ok) {
      const g = ownerView.value.items.find((x) => x.id === groupId)!;
      expect(g.joined).toBe(true);
      expect(g.memberCount).toBe(1);
    }
    const otherView = await communityService.listGroups({ userId: other.id });
    if (otherView.ok) expect(otherView.value.items.find((x) => x.id === groupId)!.joined).toBe(false);

    await communityService.join({ groupId, userId: other.id });
    const after = await communityService.listGroups({ userId: other.id });
    if (after.ok) {
      const g = after.value.items.find((x) => x.id === groupId)!;
      expect(g.joined).toBe(true);
      expect(g.memberCount).toBe(2);
    }
  });

  it('join is idempotent (double-join does not duplicate membership)', async () => {
    const owner = await makeUser({ role: 'worker' });
    const u = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);
    await communityService.join({ groupId, userId: u.id });
    await communityService.join({ groupId, userId: u.id });
    const count = await prisma.groupMember.count({ where: { groupId } });
    expect(count).toBe(2); // owner + u, not 3
  });
});

describe('community — posts', () => {
  it('lets a member post and blocks a non-member', async () => {
    const owner = await makeUser({ role: 'worker' });
    const stranger = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);

    const okPost = await communityService.createPost({ groupId, authorId: owner.id, body: 'Masons needed in Mingora bazaar tomorrow' });
    expect(okPost.ok).toBe(true);

    const blocked = await communityService.createPost({ groupId, authorId: stranger.id, body: 'hi' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('FORBIDDEN');
  });

  it('lists pinned posts first, then newest', async () => {
    const owner = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);
    const p1 = await communityService.createPost({ groupId, authorId: owner.id, body: 'first post' });
    const p2 = await communityService.createPost({ groupId, authorId: owner.id, body: 'second post' });
    if (!p1.ok || !p2.ok) throw new Error();
    // Pin the FIRST (older) post — it should still sort to the top.
    await prisma.post.update({ where: { id: p1.value.postId }, data: { pinned: true } });

    const list = await communityService.listPosts({ groupId });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.items[0]!.id).toBe(p1.value.postId);
      expect(list.value.items[0]!.pinned).toBe(true);
    }
  });

  it('paginates the non-pinned post tail; pinned stays on page 1 only', async () => {
    const owner = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);
    const pinned = await communityService.createPost({ groupId, authorId: owner.id, body: 'PINNED' });
    if (!pinned.ok) throw new Error();
    await prisma.post.update({ where: { id: pinned.value.postId }, data: { pinned: true } });
    for (let i = 0; i < 4; i++) {
      const p = await communityService.createPost({ groupId, authorId: owner.id, body: `tail ${i}` });
      if (!p.ok) throw new Error();
    }

    // Page 1 (limit 2): pinned prepended + first 2 of the non-pinned tail.
    const page1 = await communityService.listPosts({ groupId, limit: 2 });
    if (!page1.ok) throw new Error();
    expect(page1.value.items[0]!.id).toBe(pinned.value.postId); // pinned first
    expect(page1.value.items.filter((p) => !p.pinned)).toHaveLength(2);
    expect(page1.value.nextCursor).not.toBeNull();

    // Walk the rest — pinned must NOT reappear; every tail post seen once.
    const tailSeen: string[] = page1.value.items.filter((p) => !p.pinned).map((p) => p.id);
    let cursor = page1.value.nextCursor;
    while (cursor) {
      const pg = await communityService.listPosts({ groupId, cursor, limit: 2 });
      if (!pg.ok) throw new Error();
      expect(pg.value.items.every((p) => !p.pinned)).toBe(true); // no pinned on later pages
      tailSeen.push(...pg.value.items.map((p) => p.id));
      cursor = pg.value.nextCursor;
    }
    expect(new Set(tailSeen).size).toBe(4); // all 4 tail posts, no dupes
  });

  it('redacts a phone number from a post body and raises a fraud signal (§5)', async () => {
    const owner = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);
    const r = await communityService.createPost({
      groupId, authorId: owner.id, body: 'Call me on 0301-2345678 for work',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.redacted).toBe(true);

    const stored = await prisma.post.findUniqueOrThrow({ where: { id: r.value.postId } });
    expect(stored.body).not.toContain('2345678');
    const signal = await prisma.fraudSignal.findFirst({ where: { userId: owner.id, refType: 'post' } });
    expect(signal).not.toBeNull();
  });
});

describe('community — comments', () => {
  it('adds a comment as a member and bumps commentCount', async () => {
    const owner = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);
    const post = await communityService.createPost({ groupId, authorId: owner.id, body: 'who is free Friday?' });
    if (!post.ok) throw new Error();

    const c = await communityService.createComment({ postId: post.value.postId, authorId: owner.id, body: 'I am' });
    expect(c.ok).toBe(true);

    const comments = await communityService.listComments({ postId: post.value.postId });
    expect(comments.ok && comments.value.length).toBe(1);
    const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.value.postId } });
    expect(stored.commentCount).toBe(1);
  });

  it('blocks a non-member from commenting', async () => {
    const owner = await makeUser({ role: 'worker' });
    const stranger = await makeUser({ role: 'worker' });
    const groupId = await makeGroup(owner.id);
    const post = await communityService.createPost({ groupId, authorId: owner.id, body: 'hello group' });
    if (!post.ok) throw new Error();

    const c = await communityService.createComment({ postId: post.value.postId, authorId: stranger.id, body: 'me too' });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.code).toBe('FORBIDDEN');
  });
});

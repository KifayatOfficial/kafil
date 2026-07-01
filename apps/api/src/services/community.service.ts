// §2.8 / v1.0 §4 — COMMUNITY. Groups (geographic + trade), posts (announcements,
// offers, requests, discussion), and comments. This is the "community" half of KAFIL's
// "hyperlocal community marketplace" identity — the gig loop is the other half.
//
// Design rules:
//   - Creating a group auto-joins the creator as admin (P-of-least-surprise).
//   - Posting/commenting requires membership (you join a group to participate) — keeps
//     the early communities coherent and gives moderation a natural boundary.
//   - Bodies run through the SAME PII redactor as chat (§5): a public post is the
//     easiest place to dump a phone number and route around the platform, so we strip
//     it and raise a fraud signal on fee/contact patterns — consistent with job posts.
//   - Banned/suspended users can't create groups, post, or comment.
//   - Everything is reportable via the existing T&S subsystem (targetType 'post' etc.).

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { communityRepository } from '../repositories/community.repository';
import { clampLimit, cursorWhere, decodeCursor, paginate } from '../lib/cursor';
import { redact } from './pii-redactor';

const GROUP_CATEGORIES = ['geographic', 'trade', 'general'] as const;
const POST_KINDS = ['discussion', 'announcement', 'offer', 'request'] as const;

async function assertActiveUser(userId: string): Promise<Result<true>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!u) return err('NOT_FOUND', 'user not found');
  if (u.status === 'banned' || u.status === 'suspended') {
    return err('FORBIDDEN', 'your account cannot post right now');
  }
  return ok(true);
}

export const communityService = {
  // ── groups ─────────────────────────────────────────────────────────────
  async createGroup(args: {
    creatorId: string;
    name: string;
    description?: string;
    category?: string;
    locationId?: string;
  }): Promise<Result<{ groupId: string }>> {
    const name = args.name.trim();
    if (name.length < 3) return err('VALIDATION', 'group name must be at least 3 characters');
    if (name.length > 200) return err('VALIDATION', 'group name too long');
    const category = args.category && GROUP_CATEGORIES.includes(args.category as never)
      ? args.category
      : 'general';
    const active = await assertActiveUser(args.creatorId);
    if (!active.ok) return active;

    const groupId = await prisma.$transaction(async (tx) => {
      const group = await communityRepository.createGroup(tx, {
        name,
        description: args.description?.trim() || null,
        category,
        locationId: args.locationId ?? null,
        createdBy: args.creatorId,
      });
      // Creator is the first member + admin.
      await communityRepository.addMember(tx, { groupId: group.id, userId: args.creatorId, role: 'admin' });
      await emitEvent(tx, {
        eventType: 'group.created',
        actorId: args.creatorId,
        refType: 'group',
        refId: group.id,
        payload: { name, category },
      });
      return group.id;
    });
    return ok({ groupId });
  },

  /** Group directory with membership flags for the caller. */
  async listGroups(args: { userId: string; category?: string; cursor?: string | null; limit?: number }): Promise<
    Result<{
      items: Array<{ id: string; name: string; description: string | null; category: string | null; memberCount: number; postCount: number; joined: boolean; location: { label: string; district: string | null } | null }>;
      nextCursor: string | null;
    }>
  > {
    // §P1.4b — keyset-paginated directory (grows unbounded; year-1 target is many groups).
    const limit = clampLimit(args.limit);
    const cursor = decodeCursor(args.cursor);
    const [rows, myIds] = await Promise.all([
      communityRepository.listGroups({ category: args.category, take: limit + 1, cursorWhere: cursorWhere(cursor) }),
      communityRepository.memberGroupIds(args.userId),
    ]);
    const { items, nextCursor } = paginate(rows, limit);
    return ok({
      items: items.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        category: g.category,
        memberCount: g._count.members,
        postCount: g._count.posts,
        joined: myIds.has(g.id),
        location: g.location ? { label: g.location.label, district: g.location.district } : null,
      })),
      nextCursor,
    });
  },

  async join(args: { groupId: string; userId: string }): Promise<Result<{ joined: true }>> {
    const group = await communityRepository.findGroup(args.groupId);
    if (!group || group.status !== 'active') return err('NOT_FOUND', 'group not found');
    const active = await assertActiveUser(args.userId);
    if (!active.ok) return active;
    await prisma.$transaction(async (tx) => {
      await communityRepository.addMember(tx, { groupId: args.groupId, userId: args.userId });
      await emitEvent(tx, { eventType: 'group.joined', actorId: args.userId, refType: 'group', refId: args.groupId });
    });
    return ok({ joined: true });
  },

  async leave(args: { groupId: string; userId: string }): Promise<Result<{ left: true }>> {
    await communityRepository.removeMember(args.groupId, args.userId);
    return ok({ left: true });
  },

  // ── posts ──────────────────────────────────────────────────────────────
  async createPost(args: {
    groupId: string;
    authorId: string;
    body: string;
    kind?: string;
    images?: string[];
  }): Promise<Result<{ postId: string; redacted: boolean }>> {
    const body = args.body.trim();
    if (!body && (!args.images || args.images.length === 0)) {
      return err('VALIDATION', 'a post needs text or an image');
    }
    const active = await assertActiveUser(args.authorId);
    if (!active.ok) return active;

    const group = await communityRepository.findGroup(args.groupId);
    if (!group || group.status !== 'active') return err('NOT_FOUND', 'group not found');

    // Membership gate — join to post.
    const membership = await communityRepository.findMembership(args.groupId, args.authorId);
    if (!membership) return err('FORBIDDEN', 'join the group to post');

    const kind = args.kind && POST_KINDS.includes(args.kind as never) ? args.kind : 'discussion';

    // §5 — strip PII (phones/socials/urls) + flag fee patterns, exactly like job posts.
    const scan = redact(body);
    const feeHit = scan.hits.some((h) => h.kind === 'fee_pattern');
    const contactHit = scan.hits.some((h) => h.kind === 'phone' || h.kind === 'social' || h.kind === 'url');

    const postId = await prisma.$transaction(async (tx) => {
      const post = await communityRepository.createPost(tx, {
        groupId: args.groupId,
        authorId: args.authorId,
        kind,
        body: scan.redacted, // store the redacted body, never the raw one
        images: (args.images ?? []) as unknown as object,
      });
      if (feeHit || contactHit) {
        await tx.fraudSignal.create({
          data: {
            userId: args.authorId,
            signal: feeHit ? 'fee_request_in_post' : 'contact_in_post',
            weight: feeHit ? 60 : 30,
            refType: 'post',
            refId: post.id,
          },
        });
      }
      await emitEvent(tx, {
        eventType: 'post.created',
        actorId: args.authorId,
        refType: 'post',
        refId: post.id,
        payload: { group_id: args.groupId, kind, redacted: scan.flagged },
      });
      return post.id;
    });
    return ok({ postId, redacted: scan.flagged });
  },

  async listPosts(args: { groupId: string }): Promise<
    Result<Array<{ id: string; kind: string; body: string | null; images: string[]; pinned: boolean; commentCount: number; createdAt: Date; author: { id: string; displayName: string; photoUrl: string | null } }>>
  > {
    const rows = await communityRepository.listPosts(args.groupId);
    return ok(
      rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        body: p.body,
        images: (p.images as unknown as string[]) ?? [],
        pinned: p.pinned,
        commentCount: p.commentCount,
        createdAt: p.createdAt,
        author: p.author,
      })),
    );
  },

  // ── comments ─────────────────────────────────────────────────────────────
  async createComment(args: { postId: string; authorId: string; body: string }): Promise<Result<{ commentId: string; redacted: boolean }>> {
    const body = args.body.trim();
    if (!body) return err('VALIDATION', 'comment cannot be empty');
    const active = await assertActiveUser(args.authorId);
    if (!active.ok) return active;

    const post = await communityRepository.findPost(args.postId);
    if (!post || post.status !== 'visible') return err('NOT_FOUND', 'post not found');
    // Must be a member of the post's group to comment.
    const membership = await communityRepository.findMembership(post.groupId, args.authorId);
    if (!membership) return err('FORBIDDEN', 'join the group to comment');

    const scan = redact(body);
    const commentId = await prisma.$transaction(async (tx) => {
      const c = await communityRepository.createComment(tx, {
        postId: args.postId,
        authorId: args.authorId,
        body: scan.redacted,
      });
      await communityRepository.incrementCommentCount(tx, args.postId);
      await emitEvent(tx, {
        eventType: 'comment.created',
        actorId: args.authorId,
        refType: 'comment',
        refId: c.id,
        payload: { post_id: args.postId },
      });
      return c.id;
    });
    return ok({ commentId, redacted: scan.flagged });
  },

  async listComments(args: { postId: string }): Promise<
    Result<Array<{ id: string; body: string | null; createdAt: Date; author: { id: string; displayName: string; photoUrl: string | null } }>>
  > {
    const rows = await communityRepository.listComments(args.postId);
    return ok(rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: c.author })));
  },
};

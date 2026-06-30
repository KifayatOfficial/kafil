// Repository layer (P2): the ONLY layer that talks to the database.
// §2.8 / v1.0 §4 — community: groups, memberships, posts, comments.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

const authorSelect = { id: true, displayName: true, photoUrl: true } as const;

export const communityRepository = {
  // ── groups ─────────────────────────────────────────────────────────────
  createGroup(tx: Prisma.TransactionClient, data: Prisma.GroupUncheckedCreateInput) {
    return tx.group.create({ data });
  },

  findGroup(id: string) {
    return prisma.group.findUnique({
      where: { id },
      include: { location: { select: { label: true, district: true, tehsil: true } } },
    });
  },

  /** Active groups, optionally filtered by category, newest first, with member counts. */
  listGroups(args: { category?: string; limit?: number }) {
    return prisma.group.findMany({
      where: { status: 'active', ...(args.category ? { category: args.category } : {}) },
      orderBy: { createdAt: 'desc' },
      take: args.limit ?? 50,
      include: {
        location: { select: { label: true, district: true } },
        _count: { select: { members: true, posts: true } },
      },
    });
  },

  // ── membership ───────────────────────────────────────────────────────────
  addMember(tx: Prisma.TransactionClient, data: { groupId: string; userId: string; role?: string }) {
    return tx.groupMember.upsert({
      where: { groupId_userId: { groupId: data.groupId, userId: data.userId } },
      create: { groupId: data.groupId, userId: data.userId, role: data.role ?? 'member' },
      update: {}, // already a member → no-op (idempotent join)
    });
  },

  removeMember(groupId: string, userId: string) {
    return prisma.groupMember.deleteMany({ where: { groupId, userId } });
  },

  findMembership(groupId: string, userId: string) {
    return prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  },

  /** The group ids a user belongs to (for "my groups" + membership checks in bulk). */
  async memberGroupIds(userId: string): Promise<Set<string>> {
    const rows = await prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } });
    return new Set(rows.map((r) => r.groupId));
  },

  // ── posts ──────────────────────────────────────────────────────────────
  createPost(tx: Prisma.TransactionClient, data: Prisma.PostUncheckedCreateInput) {
    return tx.post.create({ data });
  },

  findPost(id: string) {
    return prisma.post.findUnique({ where: { id } });
  },

  /** Visible posts in a group — pinned first, then newest. */
  listPosts(groupId: string, limit = 50) {
    return prisma.post.findMany({
      where: { groupId, status: 'visible' },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { author: { select: authorSelect } },
    });
  },

  // ── comments ─────────────────────────────────────────────────────────────
  createComment(tx: Prisma.TransactionClient, data: Prisma.CommentUncheckedCreateInput) {
    return tx.comment.create({ data });
  },

  /** Bump the denormalized comment counter in the same txn as the insert. */
  incrementCommentCount(tx: Prisma.TransactionClient, postId: string) {
    return tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
  },

  listComments(postId: string, limit = 100) {
    return prisma.comment.findMany({
      where: { postId, status: 'visible' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { author: { select: authorSelect } },
    });
  },
};

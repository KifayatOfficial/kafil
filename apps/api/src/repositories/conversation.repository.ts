// §2.7 — conversations + messages.
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const conversationRepository = {
  /** Used by acceptApplication to create-or-return the assignment's conversation. */
  async ensureForAssignment(
    tx: Prisma.TransactionClient,
    args: { jobId: string; workerId: string; employerId: string; assignmentId: string },
  ) {
    // We key the conversation by jobId for now; one job slot pair = one conversation,
    // which is the common case (single accept per slot). For multi-slot jobs each
    // worker gets their own conversation because the participant set differs.
    const existing = await tx.conversation.findFirst({
      where: {
        jobId: args.jobId,
        participants: {
          every: { userId: { in: [args.workerId, args.employerId] } },
        },
      },
      include: { participants: true },
    });
    if (existing && existing.participants.length === 2) return existing;

    return tx.conversation.create({
      data: {
        jobId: args.jobId,
        participants: {
          create: [{ userId: args.workerId }, { userId: args.employerId }],
        },
      },
    });
  },

  findById(id: string) {
    return prisma.conversation.findUnique({
      where: { id },
      include: { participants: true },
    });
  },

  listForUser(userId: string) {
    return prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: { include: { user: { select: { id: true, displayName: true } } } },
        // §5/§24/B1 — the last-message preview must NEVER carry the raw body. Select
        // bodyRedacted explicitly; omitting `select` would ship the unredacted `body`.
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true, senderId: true, bodyRedacted: true, flagged: true, createdAt: true },
        },
      },
      take: 50,
    });
  },

  listMessages(conversationId: string, limit = 100) {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  },

  createMessage(
    tx: Prisma.TransactionClient,
    data: Prisma.MessageUncheckedCreateInput,
  ) {
    return tx.message.create({ data });
  },

  /** Stamp the caller's read cursor to now. Returns the number of rows updated (0 if the
   *  user isn't a participant — the service pre-checks, but this stays safe on its own). */
  markRead(conversationId: string, userId: string) {
    return prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
  },

  /**
   * Per-conversation unread counts for one user, across every conversation they're in.
   * Unread = a message from SOMEONE ELSE created after the user's lastReadAt (or ever, if
   * they've never opened the thread). One grouped query — no N+1. Conversations with zero
   * unread are simply absent from the result (callers default them to 0).
   */
  async unreadCountsForUser(userId: string): Promise<Map<string, number>> {
    const rows = await prisma.$queryRaw<Array<{ conversation_id: string; unread: bigint }>>`
      SELECT m.conversation_id, count(*) AS unread
      FROM messages m
      JOIN conversation_participants cp
        ON cp.conversation_id = m.conversation_id AND cp.user_id = ${userId}::uuid
      WHERE m.sender_id <> ${userId}::uuid
        AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
      GROUP BY m.conversation_id
    `;
    return new Map(rows.map((r) => [r.conversation_id, Number(r.unread)]));
  },
};

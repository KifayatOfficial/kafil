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
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
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
};

// Repository layer (P2): the ONLY layer that talks to the database.
// §9–§10 Trust & Safety persistence: reports, fraud signals, user blocks,
// moderation actions, banned identities.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const safetyRepository = {
  // ── reports (§2.10) ──────────────────────────────────────────────────────
  createReport(tx: Prisma.TransactionClient, data: Prisma.ReportUncheckedCreateInput) {
    return tx.report.create({ data });
  },

  /** Has this reporter already filed an open report against this exact target? */
  findOpenReport(args: { reporterId: string; targetType: string; targetId: string }) {
    return prisma.report.findFirst({
      where: {
        reporterId: args.reporterId,
        targetType: args.targetType,
        targetId: args.targetId,
        status: 'open',
      },
    });
  },

  /** Count distinct reporters against a target — feeds auto-friction thresholds. */
  async countDistinctReporters(args: { targetType: string; targetId: string }): Promise<number> {
    const rows = await prisma.report.findMany({
      where: { targetType: args.targetType, targetId: args.targetId },
      select: { reporterId: true },
      distinct: ['reporterId'],
    });
    return rows.length;
  },

  // ── fraud signals (§2.10 / §10) ──────────────────────────────────────────
  createFraudSignal(tx: Prisma.TransactionClient, data: Prisma.FraudSignalUncheckedCreateInput) {
    return tx.fraudSignal.create({ data });
  },

  /** Sum of signal weights for a user — the raw fraud score (§9 trust_score input). */
  async sumSignalWeight(userId: string): Promise<number> {
    const agg = await prisma.fraudSignal.aggregate({
      where: { userId },
      _sum: { weight: true },
    });
    return agg._sum.weight ?? 0;
  },

  // ── user blocks (§25.9 / F11) ────────────────────────────────────────────
  upsertBlock(tx: Prisma.TransactionClient, data: { userId: string; blockedId: string; reason?: string | null }) {
    return tx.userBlock.upsert({
      where: { userId_blockedId: { userId: data.userId, blockedId: data.blockedId } },
      create: { userId: data.userId, blockedId: data.blockedId, reason: data.reason ?? null },
      update: { reason: data.reason ?? null },
    });
  },

  deleteBlock(userId: string, blockedId: string) {
    return prisma.userBlock.deleteMany({ where: { userId, blockedId } });
  },

  /** True if either user has blocked the other (block is symmetric for matching/chat). */
  async blockExistsBetween(a: string, b: string): Promise<boolean> {
    const found = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { userId: a, blockedId: b },
          { userId: b, blockedId: a },
        ],
      },
      select: { userId: true },
    });
    return !!found;
  },

  // ── moderation actions + user status (§2.11 / §9) ────────────────────────
  createModerationAction(
    tx: Prisma.TransactionClient,
    data: Prisma.ModerationActionUncheckedCreateInput,
  ) {
    return tx.moderationAction.create({ data });
  },

  setUserStatus(
    tx: Prisma.TransactionClient,
    args: { userId: string; status: string; reason: string | null },
  ) {
    return tx.user.update({
      where: { id: args.userId },
      data: { status: args.status, statusReason: args.reason, version: { increment: 1 } },
    });
  },

  findUser(userId: string) {
    return prisma.user.findUnique({ where: { id: userId } });
  },
};

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const reviewRepository = {
  create(tx: Prisma.TransactionClient, data: Prisma.ReviewUncheckedCreateInput) {
    return tx.review.create({ data });
  },
  findByAssignment(assignmentId: string) {
    return prisma.review.findMany({ where: { assignmentId } });
  },
  /** Resolve the counterparty's review (if any) inside a txn. */
  findCounterpart(
    tx: Prisma.TransactionClient,
    args: { assignmentId: string; authorIdNot: string },
  ) {
    return tx.review.findFirst({
      where: { assignmentId: args.assignmentId, authorId: { not: args.authorIdNot } },
    });
  },
  /** §7 — mark both reviews on an assignment visible (used when both submit). */
  revealBoth(tx: Prisma.TransactionClient, assignmentId: string) {
    return tx.review.updateMany({
      where: { assignmentId, visibleAt: null },
      data: { visibleAt: new Date() },
    });
  },
};

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const applicationRepository = {
  create(tx: Prisma.TransactionClient, data: Prisma.ApplicationUncheckedCreateInput) {
    return tx.application.create({ data });
  },
  findById(id: string) {
    return prisma.application.findUnique({ where: { id } });
  },
  /** §24/A5 — only one ACTIVE app per (job, worker). Partial unique index enforces it. */
  findActive(jobId: string, workerId: string) {
    return prisma.application.findFirst({
      where: { jobId, workerId, status: { in: ['pending', 'shortlisted', 'accepted'] } },
    });
  },
  setStatus(tx: Prisma.TransactionClient, id: string, status: string) {
    return tx.application.update({
      where: { id },
      data: { status, decidedAt: new Date() },
    });
  },
};

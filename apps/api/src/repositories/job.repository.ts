// Repository layer (P2): the ONLY layer that talks to the database.
// Services consume this interface; nothing knows about HTTP.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const jobRepository = {
  create(tx: Prisma.TransactionClient, data: Prisma.JobUncheckedCreateInput) {
    return tx.job.create({ data });
  },
  createSlot(tx: Prisma.TransactionClient, data: Prisma.JobSlotUncheckedCreateInput) {
    return tx.jobSlot.create({ data });
  },
  attachSpecialties(
    tx: Prisma.TransactionClient,
    jobId: string,
    specialtyIds: string[],
  ) {
    return tx.jobSpecialty.createMany({
      data: specialtyIds.map((sid) => ({ jobId, specialtyId: sid })),
      skipDuplicates: true,
    });
  },
  findById(jobId: string) {
    return prisma.job.findUnique({
      where: { id: jobId },
      include: { slots: true, specialties: { include: { specialty: true } } },
    });
  },
  list(args: { status?: string; limit?: number }) {
    return prisma.job.findMany({
      where: args.status ? { status: args.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: args.limit ?? 20,
      include: { slots: true },
    });
  },
};

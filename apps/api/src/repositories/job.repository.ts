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
      // §6.1 — currently-featured jobs sort first (Postgres NULLS LAST puts unfeatured
      // and lapsed boosts after), then newest-first within each group. A lapsed
      // featured_until (in the past) still sorts ahead of nulls here, so the service
      // layer is the source of truth for "is it *currently* featured"; this ordering is
      // a cheap best-effort. The plain feed is the pre-onboarding fallback, so exactness
      // matters less than in the ranked feed (which gates on now()).
      orderBy: [{ featuredUntil: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: args.limit ?? 20,
      include: { slots: true },
    });
  },
};

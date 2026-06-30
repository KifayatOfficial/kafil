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
  // §P1.4 — keyset-paginated plain feed. Orders strictly by (createdAt DESC, id DESC) so
  // the cursor tuple is monotonic and the page boundary stays stable under inserts. The
  // featured-first sort lives in the RANKED feed (which gates on now()); this plain feed
  // is the pre-onboarding fallback where chronological order is correct. The caller passes
  // `take` already = limit + 1 so the service can detect whether a next page exists.
  list(args: { status?: string; take: number; cursorWhere?: object }) {
    const base = args.status ? { status: args.status } : {};
    return prisma.job.findMany({
      where: { ...base, ...(args.cursorWhere ?? {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: args.take,
      include: { slots: true },
    });
  },
};

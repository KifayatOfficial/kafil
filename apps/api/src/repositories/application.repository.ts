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
  /** §3 — worker's own applications, with the job embedded for the UI list. */
  listForWorker(workerId: string, limit = 50) {
    return prisma.application.findMany({
      where: { workerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        job: {
          select: {
            id: true,
            title: true,
            ratePkr: true,
            rateUnit: true,
            status: true,
            employerId: true,
          },
        },
      },
    });
  },
  /** Employer's view: who applied to a specific job (their own). */
  listForJob(jobId: string, limit = 100) {
    return prisma.application.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        worker: {
          select: {
            id: true,
            displayName: true,
            photoUrl: true,
            kycLevel: true,
            workerProfile: {
              select: {
                ratingBayesian: true,
                jobsCompleted: true,
                bio: true,
              },
            },
          },
        },
      },
    });
  },
};

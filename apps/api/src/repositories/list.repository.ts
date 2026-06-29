// Simple list-helpers for owner-only data: an employer's own jobs.
import { prisma } from '../lib/db';

export const listRepository = {
  jobsForEmployer(employerId: string, limit = 50) {
    return prisma.job.findMany({
      where: { employerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        slots: { select: { id: true, status: true, assignedWorkerId: true, version: true, slotIndex: true } },
        _count: { select: { applications: true } },
      },
    });
  },
};

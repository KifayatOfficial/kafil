// §2.3 — assignment + slot persistence with optimistic locking (P5 + §24/A4).
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const assignmentRepository = {
  /** §24/A4 — atomic slot fill with optimistic lock. Returns updated row or null on race. */
  async fillSlot(
    tx: Prisma.TransactionClient,
    args: { slotId: string; expectedVersion: number; workerId: string },
  ) {
    const res = await tx.jobSlot.updateMany({
      where: { id: args.slotId, status: 'open', version: args.expectedVersion },
      data: {
        status: 'filled',
        assignedWorkerId: args.workerId,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) return null;
    return tx.jobSlot.findUnique({ where: { id: args.slotId } });
  },

  createAssignment(
    tx: Prisma.TransactionClient,
    data: Prisma.AssignmentUncheckedCreateInput,
  ) {
    return tx.assignment.create({ data });
  },

  /** §24/A4 — recompute job-level state after a slot transition. */
  async recomputeJobState(tx: Prisma.TransactionClient, jobId: string) {
    const slots = await tx.jobSlot.findMany({ where: { jobId } });
    const openCount = slots.filter((s) => s.status === 'open').length;
    const totalActive = slots.filter((s) => s.status !== 'cancelled').length;
    const completedCount = slots.filter((s) => s.status === 'completed').length;

    let nextStatus: 'open' | 'filled' | 'completed' | null = null;
    if (completedCount === totalActive && totalActive > 0) nextStatus = 'completed';
    else if (openCount === 0) nextStatus = 'filled';
    else nextStatus = 'open';

    await tx.job.updateMany({
      where: { id: jobId, status: { not: nextStatus } },
      data: { status: nextStatus, version: { increment: 1 } },
    });
  },

  findById(assignmentId: string) {
    return prisma.assignment.findUnique({ where: { id: assignmentId } });
  },
};

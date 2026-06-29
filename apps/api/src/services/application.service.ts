import { ApplyToJobInput } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { applicationRepository } from '../repositories/application.repository';

export const applicationService = {
  /** Worker applies to a job. §24/A5 partial unique → re-apply allowed after terminal. */
  async apply(args: {
    workerId: string;
    jobId: string;
    input: unknown;
  }): Promise<Result<{ applicationId: string }>> {
    const parse = ApplyToJobInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const i = parse.data;

    // §10/F1 — workers never pay to apply. (Server contract: zero amount, ever.)
    const job = await prisma.job.findUnique({
      where: { id: args.jobId },
      select: { id: true, status: true },
    });
    if (!job) return err('NOT_FOUND', 'job not found');
    if (job.status !== 'open') return err('CONFLICT', 'job is not open');

    const active = await applicationRepository.findActive(args.jobId, args.workerId);
    if (active) return err('CONFLICT', 'you already have an active application');

    const result = await prisma.$transaction(async (tx) => {
      const app = await applicationRepository.create(tx, {
        jobId: args.jobId,
        workerId: args.workerId,
        status: 'pending',
        message: i.message ?? null,
        proposedRatePkr: i.proposed_rate_pkr ?? null,
        idempotencyKey: i.idempotency_key,
      });
      await emitEvent(tx, {
        eventType: 'application.created',
        actorId: args.workerId,
        refType: 'application',
        refId: app.id,
        payload: { job_id: args.jobId },
      });
      return { applicationId: app.id };
    });

    return ok(result);
  },
};

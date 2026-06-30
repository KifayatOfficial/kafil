import { ApplyToJobInput } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { applicationRepository } from '../repositories/application.repository';
import { notificationsService } from './notifications.service';

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
      select: { id: true, status: true, employerId: true, title: true },
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

    // §11 — tell the employer they have a new applicant. Awaited but non-fatal: the
    // application is already committed, so a notification failure is logged and
    // swallowed (never undoes the apply). We await rather than fire-and-forget so the
    // write completes within the request — a fire-and-forget would race a serverless
    // freeze in prod and the test cleanup in CI.
    try {
      await notificationsService.send({
        userId: job.employerId,
        type: 'application.created',
        priority: 'transactional',
        title: 'New applicant',
        body: `Someone applied to "${job.title}". Tap to review.`,
        refType: 'job',
        refId: job.id,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[application] new-applicant notification failed:', e instanceof Error ? e.message : String(e));
    }

    return ok(result);
  },
};

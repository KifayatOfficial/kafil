// Service layer (P2): business rules. No HTTP, no SQL.
// Implements the §4 job-creation flow + slot generation.

import { CreateJobInput, type Job } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { jobRepository } from '../repositories/job.repository';
import { clampLimit, cursorWhere, decodeCursor, paginate } from '../lib/cursor';
import { redact } from './pii-redactor';

export const jobService = {
  async createJob(args: {
    employerId: string;
    input: unknown;
  }): Promise<Result<{ jobId: string }>> {
    const parse = CreateJobInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const i = parse.data;

    // §10/F1 — workers never pay to apply. Scan the posting's title + description for
    // fee/deposit/advance language (the same detector the chat channel uses, §5). A hit
    // doesn't block the post — it raises a fraud signal so repeat fee-askers surface in
    // the ops queue and cross the auto-review threshold. Phones/contact in the body are
    // also disintermediation signals (F2).
    const scanText = `${i.title}\n${i.description ?? ''}`;
    const scan = redact(scanText);
    const feeHit = scan.hits.some((h) => h.kind === 'fee_pattern');
    const contactHit = scan.hits.some((h) => h.kind === 'phone' || h.kind === 'social' || h.kind === 'url');

    const jobId = await prisma.$transaction(async (tx) => {
      const job = await jobRepository.create(tx, {
        employerId: args.employerId,
        title: i.title,
        description: i.description ?? null,
        descriptionAudioUrl: i.description_audio_url ?? null,
        locationId: i.location_id,
        headcount: i.headcount,
        ratePkr: i.rate_pkr,
        rateUnit: i.rate_unit,
        durationDays: i.duration_days ?? null,
        startDate: i.start_date ? new Date(i.start_date) : null,
        paymentMode: i.payment_mode,
        status: 'open',
      });

      // §2.3 — one slot per headcount (the concurrency primitive).
      for (let idx = 1; idx <= i.headcount; idx++) {
        await jobRepository.createSlot(tx, {
          jobId: job.id,
          slotIndex: idx,
          status: 'open',
        });
      }

      await jobRepository.attachSpecialties(tx, job.id, i.specialty_ids);

      // §10/F1+F2 — record a weighted fraud signal when the posting smells like an
      // advance-fee scam or an off-platform contact dump. Fee asks are the ceiling.
      if (feeHit || contactHit) {
        await tx.fraudSignal.create({
          data: {
            userId: args.employerId,
            signal: feeHit ? 'fee_request_in_job' : 'contact_in_job',
            weight: feeHit ? 80 : 40,
            refType: 'job',
            refId: job.id,
          },
        });
      }

      await emitEvent(tx, {
        eventType: 'job.posted',
        actorId: args.employerId,
        refType: 'job',
        refId: job.id,
        payload: { headcount: i.headcount, rate_pkr: i.rate_pkr, feeHit, contactHit },
      });

      return job.id;
    });

    return ok({ jobId });
  },

  async getJob(jobId: string): Promise<Result<NonNullable<Awaited<ReturnType<typeof jobRepository.findById>>>>> {
    const job = await jobRepository.findById(jobId);
    if (!job) return err('NOT_FOUND', 'job not found');
    return ok(job);
  },

  // §P1.4 — paginated open feed. Returns one page + an opaque nextCursor (null at the
  // end). Fetches limit+1 to know whether another page exists without a second query.
  async listOpen(args?: { cursor?: string | null; limit?: number }): Promise<
    Result<{ items: Awaited<ReturnType<typeof jobRepository.list>>; nextCursor: string | null }>
  > {
    const limit = clampLimit(args?.limit);
    const cursor = decodeCursor(args?.cursor);
    const rows = await jobRepository.list({
      status: 'open',
      take: limit + 1,
      cursorWhere: cursorWhere(cursor),
    });
    return ok(paginate(rows, limit));
  },
};

export type { Job };

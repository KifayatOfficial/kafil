// Service layer (P2): business rules. No HTTP, no SQL.
// Implements the §4 job-creation flow + slot generation.

import { CreateJobInput, type Job } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { jobRepository } from '../repositories/job.repository';

export const jobService = {
  async createJob(args: {
    employerId: string;
    input: unknown;
  }): Promise<Result<{ jobId: string }>> {
    const parse = CreateJobInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const i = parse.data;

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

      await emitEvent(tx, {
        eventType: 'job.posted',
        actorId: args.employerId,
        refType: 'job',
        refId: job.id,
        payload: { headcount: i.headcount, rate_pkr: i.rate_pkr },
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

  async listOpen(): Promise<Result<Awaited<ReturnType<typeof jobRepository.list>>>> {
    return ok(await jobRepository.list({ status: 'open', limit: 20 }));
  },
};

export type { Job };

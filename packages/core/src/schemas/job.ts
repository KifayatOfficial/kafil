import { z } from 'zod';
import { IdempotencyKey, MoneyMinor, Timestamp, Uuid } from './common';

// §4.1 — job lifecycle (the posting itself; an `assignment` is one worker's unit of work).
export const JobStatus = z.enum([
  'draft',
  'open',
  'filled',
  'completed',
  'expired',
  'cancelled',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const RateUnit = z.enum(['day', 'job', 'hour']);
export const PaymentMode = z.enum(['cash', 'escrow']);

// §2.3 — multi-worker via slots (v1.0 couldn't model "need 3 masons").
export const Job = z.object({
  id: Uuid,
  employer_id: Uuid,
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable(),
  description_audio_url: z.string().url().nullable(), // §12 low-literacy voice
  location_id: Uuid,
  headcount: z.number().int().positive().max(50),
  rate_pkr: z.number().int().positive(), // rate in whole PKR for legibility; ledger stores paisa
  rate_unit: RateUnit,
  duration_days: z.number().int().positive().nullable(),
  start_date: z.string().date().nullable(),
  status: JobStatus,
  expires_at: Timestamp.nullable(),
  payment_mode: PaymentMode,
  created_at: Timestamp,
  version: z.number().int().nonnegative(),
});
export type Job = z.infer<typeof Job>;

export const CreateJobInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  description_audio_url: z.string().url().optional(),
  location_id: Uuid,
  headcount: z.number().int().positive().max(50).default(1),
  rate_pkr: z.number().int().positive(),
  rate_unit: RateUnit.default('day'),
  duration_days: z.number().int().positive().optional(),
  start_date: z.string().date().optional(),
  payment_mode: PaymentMode.default('cash'),
  specialty_ids: z.array(Uuid).min(1).max(10),
  idempotency_key: IdempotencyKey,
});
export type CreateJobInput = z.infer<typeof CreateJobInput>;

// §2.3 — slot is the concurrency primitive that prevents over-hiring (P5 + §24/A4).
export const JobSlot = z.object({
  id: Uuid,
  job_id: Uuid,
  slot_index: z.number().int().positive(),
  status: z.enum(['open', 'filled', 'completed', 'cancelled']),
  assigned_worker_id: Uuid.nullable(),
  version: z.number().int().nonnegative(),
});
export type JobSlot = z.infer<typeof JobSlot>;

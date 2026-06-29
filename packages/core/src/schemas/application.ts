import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §2.4 — partial-unique-index allows re-apply after a terminal state (§24/A5).
export const ApplicationStatus = z.enum([
  'pending',
  'shortlisted',
  'accepted',
  'rejected',
  'withdrawn',
  'expired',
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const Application = z.object({
  id: Uuid,
  job_id: Uuid,
  worker_id: Uuid,
  status: ApplicationStatus,
  message: z.string().max(1000).nullable(),
  proposed_rate_pkr: z.number().int().positive().nullable(),
  created_at: Timestamp,
  decided_at: Timestamp.nullable(),
});
export type Application = z.infer<typeof Application>;

export const ApplyToJobInput = z.object({
  message: z.string().max(1000).optional(),
  proposed_rate_pkr: z.number().int().positive().optional(),
  idempotency_key: IdempotencyKey,
});
export type ApplyToJobInput = z.infer<typeof ApplyToJobInput>;

export const AcceptApplicationInput = z.object({
  // §24/B10 — accept must be idempotent. Server keys on (employer, application, key).
  idempotency_key: IdempotencyKey,
  // §24/A4 — version check on the slot the employer expects to fill.
  expected_slot_version: z.number().int().nonnegative(),
  slot_id: Uuid,
});
export type AcceptApplicationInput = z.infer<typeof AcceptApplicationInput>;

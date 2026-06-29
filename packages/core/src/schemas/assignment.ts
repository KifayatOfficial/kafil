import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §4.2 + §4.3 (amended). NOTE: 'awaiting_ops_review' is the §26/M1 evidence-fallback
// state that REPLACED the deprecated §24/A6 "auto-complete in employer's favor" rule.
// Do not implement directional fallback under any branch.
export const AssignmentStatus = z.enum([
  'assigned',
  'confirmed',
  'in_progress',
  'paused', // §24/B2 multi-day jobs
  'awaiting_employer_confirm',
  'awaiting_worker_confirm',
  'awaiting_ops_review', // §26/M1
  'completed',
  'in_review_window', // §24/B4 + §26/M4 merged in §6.2
  'finalized',
  'cancelled_by_employer',
  'cancelled_by_worker',
  'declined',
  'expired',
  'no_show',
  'disputed',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const Assignment = z.object({
  id: Uuid,
  job_id: Uuid,
  slot_id: Uuid,
  worker_id: Uuid,
  status: AssignmentStatus,
  agreed_rate_pkr: z.number().int().positive(), // snapshot at accept (§ F12 defense)
  kyc_snapshot: z.unknown().nullable(), // §26/M8 — frozen KYC at acceptance
  started_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  worker_marked_done_at: Timestamp.nullable(),
  employer_marked_done_at: Timestamp.nullable(),
  version: z.number().int().nonnegative(),
});
export type Assignment = z.infer<typeof Assignment>;

// Transition inputs — every state-changing endpoint is idempotent (P4).
export const TransitionInput = z.object({
  idempotency_key: IdempotencyKey,
  expected_version: z.number().int().nonnegative(),
});

export const MarkDoneInput = TransitionInput.extend({
  // §26/M1 — verifiable signals attached at "done" time, used to gate auto-completion
  // or route to awaiting_ops_review.
  photo_urls: z.array(z.string().url()).max(10).default([]),
  geo: z
    .object({ lat: z.number(), lng: z.number(), accuracy_m: z.number().positive() })
    .nullable(),
});

export const CancelInput = TransitionInput.extend({
  reason: z.string().max(500).optional(),
});

export const NoShowReportInput = TransitionInput.extend({
  notes: z.string().max(500).optional(),
});

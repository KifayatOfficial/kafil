import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §2.5 + §7 — double-blind reviews, role-aware, FK-backed.
export const ReviewDirection = z.enum(['employer_on_worker', 'worker_on_employer']);

export const Review = z.object({
  id: Uuid,
  assignment_id: Uuid,
  author_id: Uuid,
  subject_id: Uuid,
  direction: ReviewDirection,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  visible_at: Timestamp.nullable(), // hidden until both submit OR window closes (§7)
  created_at: Timestamp,
});
export type Review = z.infer<typeof Review>;

export const SubmitReviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  idempotency_key: IdempotencyKey,
});

import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §9–§10 — Trust & Safety. Reports, blocks, and moderator actions are MVP (P7),
// not later. Schema rows live in §2.10/§2.11 (reports, fraud_signals,
// moderation_actions, banned_identities, user_blocks).

// What a user can report. Mirrors the polymorphic reports.target_type column.
export const ReportTargetType = z.enum(['user', 'job', 'message', 'post', 'shop']);
export type ReportTargetType = z.infer<typeof ReportTargetType>;

// One-tap reasons (§9 "report scam"). Free-text detail is optional so a low-literacy
// user can report with a single tap and no typing.
export const ReportReason = z.enum([
  'scam', // F1 advance-fee / recruitment fraud
  'fee_request', // asked me to pay to apply (F1, explicit)
  'fake', // fake profile / job (F3)
  'off_platform', // tried to take it off-platform (F2)
  'harassment', // F11
  'spam', // F8
  'other',
]);
export type ReportReason = z.infer<typeof ReportReason>;

export const Report = z.object({
  id: Uuid,
  reporter_id: Uuid,
  target_type: ReportTargetType,
  target_id: Uuid,
  reason: ReportReason,
  detail: z.string().max(2000).nullable(),
  status: z.enum(['open', 'reviewing', 'actioned', 'dismissed']),
  created_at: Timestamp,
});
export type Report = z.infer<typeof Report>;

export const CreateReportInput = z.object({
  target_type: ReportTargetType,
  target_id: Uuid,
  reason: ReportReason,
  detail: z.string().max(2000).optional(),
  idempotency_key: IdempotencyKey,
});
export type CreateReportInput = z.infer<typeof CreateReportInput>;

// §25.9 + F11 — user-level block (distinct from a platform ban). A blocked pair
// can't message or be matched to each other.
export const BlockUserInput = z.object({
  blocked_id: Uuid,
  reason: z.string().max(40).optional(),
  idempotency_key: IdempotencyKey,
});
export type BlockUserInput = z.infer<typeof BlockUserInput>;

// §9 — moderator actions. Suspensions are time-boxed + reversible; permanent bans
// require a reason. These are the verbs written to moderation_actions.action.
export const ModerationVerb = z.enum(['ban', 'suspend', 'lift', 'warn']);
export type ModerationVerb = z.infer<typeof ModerationVerb>;

export const ModerateUserInput = z.object({
  verb: ModerationVerb,
  reason: z.string().min(1).max(40),
  // Required for suspend; ignored for ban/lift/warn. Server validates.
  expires_at: Timestamp.optional(),
  idempotency_key: IdempotencyKey,
});
export type ModerateUserInput = z.infer<typeof ModerateUserInput>;

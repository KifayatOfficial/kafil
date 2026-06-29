import { z } from 'zod';
import { IdempotencyKey, Uuid } from './common';

// §4 + §18 — a party (worker or employer) contests an assignment outcome. Opening a
// dispute freezes money + reviews and routes to the ops workbench. Past the dispute
// window (§24/B8: 7 days post-finalize) a complaint is a report, not a dispute.

export const DisputeCategory = z.enum([
  'not_done', // work wasn't done / not as agreed
  'quality', // done but poor quality
  'no_show', // counterparty never showed
  'payment', // payment dispute (cash mode)
  'rate', // rate changed / bait-and-switch (§10/F12)
  'safety', // harassment / safety on-site (§10/F11)
  'other',
]);
export type DisputeCategory = z.infer<typeof DisputeCategory>;

export const OpenDisputeInput = z.object({
  category: DisputeCategory,
  detail: z.string().max(2000).optional(),
  idempotency_key: IdempotencyKey,
});
export type OpenDisputeInput = z.infer<typeof OpenDisputeInput>;

// Evidence kinds (§2.10 dispute_evidence). A photo/url, free text, or a pointer to a
// chat message that proves something.
export const DisputeEvidenceKind = z.enum(['photo', 'text', 'message', 'other']);
export type DisputeEvidenceKind = z.infer<typeof DisputeEvidenceKind>;

export const AddEvidenceInput = z
  .object({
    kind: DisputeEvidenceKind,
    url: z.string().url().max(2000).optional(),
    body: z.string().max(2000).optional(),
    message_id: Uuid.optional(),
    idempotency_key: IdempotencyKey,
  })
  // At least one of url/body/message_id must be present, matching the kind.
  .refine((v) => !!v.url || !!v.body || !!v.message_id, {
    message: 'evidence requires one of url, body, or message_id',
  });
export type AddEvidenceInput = z.infer<typeof AddEvidenceInput>;

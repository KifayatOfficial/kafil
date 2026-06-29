import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §2.7 + §5 — in-app chat is the anti-disintermediation channel. Body is redacted
// before delivery by the server (§24/B1 + §26/M5: on-region, never persisted plaintext,
// not run on CNIC/medical-class images).
export const Message = z.object({
  id: Uuid,
  conversation_id: Uuid,
  sender_id: Uuid,
  body: z.string().max(4000).nullable(),
  body_redacted: z.string().max(4000).nullable(),
  flagged: z.boolean(),
  created_at: Timestamp,
});
export type Message = z.infer<typeof Message>;

export const SendMessageInput = z.object({
  body: z.string().min(1).max(4000),
  idempotency_key: IdempotencyKey,
});

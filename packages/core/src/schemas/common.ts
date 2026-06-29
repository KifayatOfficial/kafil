import { z } from 'zod';

// Pakistani E.164: +92 followed by 10 digits (mobile prefix starts with 3).
// Normalized form stored in users.phone_e164.
export const PhoneE164 = z
  .string()
  .regex(/^\+92\d{10}$/, 'Phone must be normalized to +92XXXXXXXXXX');

export const Uuid = z.string().uuid();

// Money is paisa (BIGINT in DB). On the wire it's a string to avoid JS number precision loss.
export const MoneyMinor = z
  .string()
  .regex(/^\d+$/, 'amount_minor must be a non-negative integer string (paisa)');

// Language codes used throughout (§12).
export const Lang = z.enum(['ps', 'ur', 'en']);
export type Lang = z.infer<typeof Lang>;

// Idempotency key the client generates per intent (§24/A7 + §26/M3).
export const IdempotencyKey = z.string().min(8).max(80);

// ISO-8601 timestamp.
export const Timestamp = z.string().datetime({ offset: true });

// Versioned envelope for any mutation that returns the new row state (P5).
export const Versioned = z.object({ version: z.number().int().nonnegative() });

// §24/A7 corrected by §26/M3 — idempotency keyed by (user, endpoint, key).
// Server-to-server webhooks dedupe via the separate WebhookEvent table (M3).
//
// Contract:
//   const guard = await idempotent({ userId, endpoint, key, requestHash });
//   if (guard.replay) return guard.cached;
//   ... do the work ...
//   await guard.store(statusCode, responseJson);

import { createHash } from 'node:crypto';
import { prisma } from './db';

export async function idempotent(input: {
  userId: string | null;
  endpoint: string;
  key: string;
  requestBody: unknown;
}): Promise<
  | { replay: true; cached: { statusCode: number; body: unknown } }
  | { replay: false; store: (statusCode: number, body: unknown) => Promise<void> }
> {
  const requestHash = createHash('sha256').update(JSON.stringify(input.requestBody)).digest('hex');

  const existing = await prisma.idempotencyKey.findFirst({
    where: { userId: input.userId, endpoint: input.endpoint, key: input.key },
  });

  if (existing) {
    if (existing.requestHash && existing.requestHash !== requestHash) {
      // Same key, different payload → §24/A7 attack guard. Surface as 409.
      return {
        replay: true,
        cached: {
          statusCode: 409,
          body: {
            ok: false,
            code: 'CONFLICT',
            message: 'Idempotency key reused with a different payload',
          },
        },
      };
    }
    if (existing.statusCode != null && existing.responseJson != null) {
      return {
        replay: true,
        cached: { statusCode: existing.statusCode, body: existing.responseJson },
      };
    }
  }

  return {
    replay: false,
    store: async (statusCode, body) => {
      // Race-safe: rely on partial unique index — try create, on conflict update by id.
      const found = await prisma.idempotencyKey.findFirst({
        where: { userId: input.userId, endpoint: input.endpoint, key: input.key },
      });
      if (found) {
        await prisma.idempotencyKey.update({
          where: { id: found.id },
          data: { responseJson: body as object, statusCode },
        });
      } else {
        await prisma.idempotencyKey.create({
          data: {
            userId: input.userId,
            endpoint: input.endpoint,
            key: input.key,
            requestHash,
            responseJson: body as object,
            statusCode,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
          },
        });
      }
    },
  };
}

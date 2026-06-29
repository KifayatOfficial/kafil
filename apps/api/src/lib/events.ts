// P3 + P8 — every state change emits a typed event in the same transaction.
// The events table is the audit log AND the analytics spine (§16).

import { Prisma, type PrismaClient } from '@prisma/client';

export async function emitEvent(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    eventType: string;
    actorId?: string | null;
    refType?: string | null;
    refId?: string | null;
    payload?: unknown;
    deviceId?: string | null;
    requestId?: string | null;
  },
): Promise<void> {
  await tx.event.create({
    data: {
      eventType: args.eventType,
      actorId: args.actorId ?? null,
      refType: args.refType ?? null,
      refId: args.refId ?? null,
      payload: (args.payload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      deviceId: args.deviceId ?? null,
      requestId: args.requestId ?? null,
    },
  });
}

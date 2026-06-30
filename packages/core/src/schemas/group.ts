import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §2.8 + §4 (Community/Social layer) — groups are geographic/trade/interest communities
// ("Mingora Jobs", "Masons of Swat", "Apple Orchards"). Wire shape mirrors the `groups`
// Prisma model; the join state is surfaced per-caller so the directory can show "joined".

export const GroupCategory = z.enum(['geographic', 'trade', 'interest']);
export type GroupCategory = z.infer<typeof GroupCategory>;

export const GroupStatus = z.enum(['active', 'suspended', 'archived']);
export type GroupStatus = z.infer<typeof GroupStatus>;

export const Group = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable(),
  category: GroupCategory.nullable(),
  location_id: Uuid.nullable(),
  created_by: Uuid,
  status: GroupStatus,
  created_at: Timestamp,
  // Denormalized read-side helpers the directory uses (optional so the base row still parses).
  member_count: z.number().int().nonnegative().optional(),
  joined: z.boolean().optional(), // is the requesting user a member?
});
export type Group = z.infer<typeof Group>;

export const CreateGroupInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  category: GroupCategory.optional(),
  location_id: Uuid.optional(),
  idempotency_key: IdempotencyKey,
});
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;

// §9 moderation — members can be 'member' or 'admin' (creator auto-joins as admin).
export const GroupMemberRole = z.enum(['member', 'admin']);
export type GroupMemberRole = z.infer<typeof GroupMemberRole>;

export const JoinGroupInput = z.object({
  idempotency_key: IdempotencyKey,
});
export type JoinGroupInput = z.infer<typeof JoinGroupInput>;

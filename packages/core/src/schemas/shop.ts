import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §2.8 + §5 (Directory layer) — shops are the 3rd platform pillar. A shop is owned by a
// user holding the `shop_owner` role (P1: one identity, many roles). Wire shape mirrors
// the `shops` Prisma model; field names are snake_case to match the API surface.

// §6.1 monetization — free | verified | featured. `verified` is the 500 PKR/month tier
// (badge + analytics + featured listing, addendum §6 verification.shop_tier.monthly_pkr).
export const ShopVerifiedTier = z.enum(['free', 'verified', 'featured']);
export type ShopVerifiedTier = z.infer<typeof ShopVerifiedTier>;

export const ShopStatus = z.enum(['active', 'suspended', 'closed']);
export type ShopStatus = z.infer<typeof ShopStatus>;

// Structured hours, NOT a free-text "8am-6pm" string (addendum §2.8 note). Each day maps
// to a list of open intervals so "closed Friday" / split shifts are representable.
export const ShopHours = z
  .object({
    mon: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
    tue: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
    wed: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
    thu: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
    fri: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
    sat: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
    sun: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
  })
  .nullable();
export type ShopHours = z.infer<typeof ShopHours>;

export const Shop = z.object({
  id: Uuid,
  owner_id: Uuid,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable(),
  location_id: Uuid.nullable(),
  categories: z.array(z.string().max(40)), // controlled-ish vocab (e.g. 'cement','tiles','electrical')
  photos: z.array(z.string().url()),
  hours: ShopHours,
  rating_bayesian: z.number().min(0).max(5).nullable(),
  verified_tier: ShopVerifiedTier,
  status: ShopStatus,
  created_at: Timestamp,
});
export type Shop = z.infer<typeof Shop>;

export const CreateShopInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  location_id: Uuid.optional(),
  categories: z.array(z.string().max(40)).max(20).default([]),
  photos: z.array(z.string().url()).max(10).default([]),
  hours: ShopHours.optional(),
  idempotency_key: IdempotencyKey,
});
export type CreateShopInput = z.infer<typeof CreateShopInput>;

// §2.5/§7 — shop reviews are customer-on-shop (distinct from the double-blind
// worker↔employer reviews on `assignments`). 1–5 stars + optional comment.
export const ShopReview = z.object({
  id: Uuid,
  shop_id: Uuid,
  author_id: Uuid,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  status: z.enum(['visible', 'hidden', 'removed']),
  created_at: Timestamp,
});
export type ShopReview = z.infer<typeof ShopReview>;

export const SubmitShopReviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  idempotency_key: IdempotencyKey,
});
export type SubmitShopReviewInput = z.infer<typeof SubmitShopReviewInput>;

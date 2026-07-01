// §5 / v1.0 — SHOP DIRECTORY, the 3rd pillar of the platform (alongside gigs +
// community). Local material/supply shops list themselves; users discover them by
// category + area, see ratings, and review them.
//
// Reviews use the SAME Bayesian shrinkage as worker reputation (§7.2): a single 5★
// shouldn't read as "perfect", so we blend toward a prior mean until a shop has a
// track record. One review per (shop, customer) — upsert — so nobody inflates a rating
// by re-reviewing.

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { shopRepository } from '../repositories/shop.repository';
import { clampLimit, decodeRatingCursor, paginateByRating, ratingCursorWhere } from '../lib/cursor';
import { redact } from './pii-redactor';

// Bayesian prior — mirror reputation.service so shop + worker ratings read alike.
const PRIOR_MEAN = 4.2;
const PRIOR_COUNT = 5; // shops get a slightly lighter prior than workers (C=10)

function bayesian(ratings: number[]): number {
  const n = ratings.length;
  const sum = ratings.reduce((a, b) => a + b, 0);
  const score = (PRIOR_COUNT * PRIOR_MEAN + sum) / (PRIOR_COUNT + n);
  return Math.round(score * 1000) / 1000;
}

async function assertActiveUser(userId: string): Promise<Result<true>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!u) return err('NOT_FOUND', 'user not found');
  if (u.status === 'banned' || u.status === 'suspended') return err('FORBIDDEN', 'account restricted');
  return ok(true);
}

export const shopService = {
  async createShop(args: {
    ownerId: string;
    name: string;
    description?: string;
    categories?: string[];
    locationId?: string;
    photos?: string[];
  }): Promise<Result<{ shopId: string }>> {
    const name = args.name.trim();
    if (name.length < 2) return err('VALIDATION', 'shop name is required');
    if (name.length > 200) return err('VALIDATION', 'shop name too long');
    const active = await assertActiveUser(args.ownerId);
    if (!active.ok) return active;

    // Descriptions are public — strip contact info like everywhere else (§5).
    const desc = args.description ? redact(args.description).redacted : null;

    const shopId = await prisma.$transaction(async (tx) => {
      const shop = await shopRepository.create(tx, {
        ownerId: args.ownerId,
        name,
        description: desc,
        categories: (args.categories ?? []) as unknown as object,
        photos: (args.photos ?? []) as unknown as object,
        locationId: args.locationId ?? null,
      });
      await emitEvent(tx, {
        eventType: 'shop.created',
        actorId: args.ownerId,
        refType: 'shop',
        refId: shop.id,
        payload: { name },
      });
      return shop.id;
    });
    return ok({ shopId });
  },

  async updateShop(args: {
    shopId: string;
    ownerId: string;
    name?: string;
    description?: string;
    categories?: string[];
    photos?: string[];
  }): Promise<Result<{ updated: true }>> {
    const shop = await shopRepository.findById(args.shopId);
    if (!shop) return err('NOT_FOUND', 'shop not found');
    if (shop.ownerId !== args.ownerId) return err('FORBIDDEN', 'not your shop');

    const data: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const n = args.name.trim();
      if (n.length < 2) return err('VALIDATION', 'shop name is required');
      data.name = n;
    }
    if (args.description !== undefined) data.description = redact(args.description).redacted;
    if (args.categories !== undefined) data.categories = args.categories;
    if (args.photos !== undefined) data.photos = args.photos;

    await prisma.$transaction(async (tx) => {
      await shopRepository.update(tx, args.shopId, data);
      await emitEvent(tx, { eventType: 'shop.updated', actorId: args.ownerId, refType: 'shop', refId: args.shopId });
    });
    return ok({ updated: true });
  },

  async listShops(args: { category?: string; cursor?: string | null; limit?: number }): Promise<
    Result<{
      items: Array<{ id: string; name: string; description: string | null; categories: string[]; photos: string[]; verifiedTier: string; rating: number; location: { label: string; district: string | null } | null }>;
      nextCursor: string | null;
    }>
  > {
    // §P1.4b — keyset by rating (see lib/cursor rating-cursor note on eventual consistency).
    const limit = clampLimit(args.limit);
    const cursor = decodeRatingCursor(args.cursor);
    const rows = await shopRepository.list({
      category: args.category,
      take: limit + 1,
      cursorWhere: ratingCursorWhere(cursor),
    });
    const { items, nextCursor } = paginateByRating(rows, limit);
    return ok({
      items: items.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        categories: (s.categories as unknown as string[]) ?? [],
        photos: (s.photos as unknown as string[]) ?? [],
        verifiedTier: s.verifiedTier,
        rating: s.ratingBayesian ? Number(s.ratingBayesian) : 0,
        location: s.location ? { label: s.location.label, district: s.location.district } : null,
      })),
      nextCursor,
    });
  },

  async getShop(shopId: string): Promise<Result<{
    id: string; name: string; description: string | null; categories: string[]; photos: string[];
    hours: unknown; verifiedTier: string; rating: number; reviewCount: number;
    owner: { id: string; displayName: string };
    location: { label: string; district: string | null; tehsil: string | null } | null;
    reviews: Array<{ id: string; rating: number; comment: string | null; createdAt: Date; author: { id: string; displayName: string; photoUrl: string | null } }>;
  }>> {
    const shop = await shopRepository.findById(shopId);
    if (!shop || shop.status !== 'active') return err('NOT_FOUND', 'shop not found');
    const reviews = await shopRepository.listReviews(shopId);
    return ok({
      id: shop.id,
      name: shop.name,
      description: shop.description,
      categories: (shop.categories as unknown as string[]) ?? [],
      photos: (shop.photos as unknown as string[]) ?? [],
      hours: shop.hours,
      verifiedTier: shop.verifiedTier,
      rating: shop.ratingBayesian ? Number(shop.ratingBayesian) : 0,
      reviewCount: reviews.length,
      owner: shop.owner,
      location: shop.location
        ? { label: shop.location.label, district: shop.location.district, tehsil: shop.location.tehsil }
        : null,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        author: r.author,
      })),
    });
  },

  /** Leave/update a shop review (one per customer) and recompute the Bayesian rating. */
  async reviewShop(args: {
    shopId: string;
    authorId: string;
    rating: number;
    comment?: string;
  }): Promise<Result<{ rating: number }>> {
    if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
      return err('VALIDATION', 'rating must be 1–5');
    }
    const active = await assertActiveUser(args.authorId);
    if (!active.ok) return active;
    const shop = await shopRepository.findById(args.shopId);
    if (!shop || shop.status !== 'active') return err('NOT_FOUND', 'shop not found');
    // Owners can't review their own shop.
    if (shop.ownerId === args.authorId) return err('FORBIDDEN', 'you cannot review your own shop');

    const comment = args.comment ? redact(args.comment).redacted : null;

    const newRating = await prisma.$transaction(async (tx) => {
      await shopRepository.upsertReview(tx, {
        shopId: args.shopId,
        authorId: args.authorId,
        rating: args.rating,
        comment,
      });
      // Recompute the shop's Bayesian rating from all visible reviews.
      const ratings = (await tx.shopReview.findMany({
        where: { shopId: args.shopId, status: 'visible' },
        select: { rating: true },
      })).map((r) => r.rating);
      const score = bayesian(ratings);
      await shopRepository.update(tx, args.shopId, { ratingBayesian: score });
      await emitEvent(tx, {
        eventType: 'shop.reviewed',
        actorId: args.authorId,
        refType: 'shop',
        refId: args.shopId,
        payload: { rating: args.rating, new_bayesian: score },
      });
      return score;
    });
    return ok({ rating: newRating });
  },
};

export const __shopInternals = { bayesian, PRIOR_MEAN, PRIOR_COUNT };

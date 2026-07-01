// Repository layer (P2). §5 / v1.0 — shop directory: shops + customer reviews.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const shopRepository = {
  create(tx: Prisma.TransactionClient, data: Prisma.ShopUncheckedCreateInput) {
    return tx.shop.create({ data });
  },

  update(tx: Prisma.TransactionClient, id: string, data: Prisma.ShopUncheckedUpdateInput) {
    return tx.shop.update({ where: { id }, data });
  },

  findById(id: string) {
    return prisma.shop.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, displayName: true } },
        location: { select: { label: true, district: true, tehsil: true } },
      },
    });
  },

  /**
   * Active shops, optional category filter, highest-rated first. §P1.4b — keyset by
   * (ratingBayesian DESC, id DESC): id is the strict tiebreak so the cursor is monotonic
   * within a page-walk even when many shops share a rating. Caller passes take=limit+1.
   */
  list(args: { category?: string; take: number; cursorWhere?: object }) {
    return prisma.shop.findMany({
      where: {
        status: 'active',
        // categories is a JSON array; `array_contains` matches a member.
        ...(args.category ? { categories: { array_contains: args.category } } : {}),
        ...(args.cursorWhere ?? {}),
      },
      orderBy: [{ ratingBayesian: 'desc' }, { id: 'desc' }],
      take: args.take,
      include: { location: { select: { label: true, district: true } } },
    });
  },

  // ── reviews ──────────────────────────────────────────────────────────────
  upsertReview(
    tx: Prisma.TransactionClient,
    data: { shopId: string; authorId: string; rating: number; comment: string | null },
  ) {
    return tx.shopReview.upsert({
      where: { shopId_authorId: { shopId: data.shopId, authorId: data.authorId } },
      create: data,
      update: { rating: data.rating, comment: data.comment },
    });
  },

  listReviews(shopId: string, limit = 50) {
    return prisma.shopReview.findMany({
      where: { shopId, status: 'visible' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { author: { select: { id: true, displayName: true, photoUrl: true } } },
    });
  },

  /** All visible ratings for a shop — feeds the Bayesian recompute. */
  async ratings(shopId: string): Promise<number[]> {
    const rows = await prisma.shopReview.findMany({
      where: { shopId, status: 'visible' },
      select: { rating: true },
    });
    return rows.map((r) => r.rating);
  },
};

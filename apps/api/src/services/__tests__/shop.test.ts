// §5 shop directory tests. Real Postgres.
//
// Invariants:
//  1. Create + list (category filter) + owner-only update.
//  2. Reviews: 1–5 validation, one-per-customer (upsert), owner can't self-review,
//     Bayesian rating recomputes and shrinks a single 5★ toward the prior.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { shopService, __shopInternals } from '../shop.service';
import { cleanupTestData, makeUser } from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

async function makeShop(ownerId: string, name = 'Swat Cement Store', categories = ['cement']) {
  const r = await shopService.createShop({ ownerId, name, categories, description: 'Quality building materials' });
  if (!r.ok) throw new Error('createShop failed');
  return r.value.shopId;
}

describe('shops — CRUD + directory', () => {
  it('creates and lists shops, filtered by category', async () => {
    const owner = await makeUser({ role: 'employer' });
    await makeShop(owner.id, 'Cement Store', ['cement']);
    await makeShop(owner.id, 'Hardware Hub', ['hardware']);

    const all = await shopService.listShops({});
    expect(all.ok && all.value.items.length).toBe(2);

    const cement = await shopService.listShops({ category: 'cement' });
    expect(cement.ok).toBe(true);
    if (cement.ok) {
      expect(cement.value.items.length).toBe(1);
      expect(cement.value.items[0]!.name).toBe('Cement Store');
    }
  });

  it('lets the owner update and blocks a stranger', async () => {
    const owner = await makeUser({ role: 'employer' });
    const stranger = await makeUser({ role: 'employer' });
    const shopId = await makeShop(owner.id);

    const okUpd = await shopService.updateShop({ shopId, ownerId: owner.id, name: 'Renamed Store' });
    expect(okUpd.ok).toBe(true);
    const got = await shopService.getShop(shopId);
    if (got.ok) expect(got.value.name).toBe('Renamed Store');

    const blocked = await shopService.updateShop({ shopId, ownerId: stranger.id, name: 'Hijacked' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('FORBIDDEN');
  });

  it('redacts a phone number from the shop description (§5)', async () => {
    const owner = await makeUser({ role: 'employer' });
    const r = await shopService.createShop({
      ownerId: owner.id, name: 'Leaky Store', description: 'Call 0300-1234567 to order',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = await shopService.getShop(r.value.shopId);
    if (got.ok) expect(got.value.description).not.toContain('1234567');
  });
});

describe('shops — reviews + bayesian rating', () => {
  it('a single 5★ review shrinks toward the prior, not 5.0', async () => {
    const owner = await makeUser({ role: 'employer' });
    const customer = await makeUser({ role: 'worker' });
    const shopId = await makeShop(owner.id);

    const r = await shopService.reviewShop({ shopId, authorId: customer.id, rating: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // (5*4.2 + 5)/(5+1) = 26/6 ≈ 4.33 — above prior, below 5.
      expect(r.value.rating).toBeGreaterThan(__shopInternals.PRIOR_MEAN);
      expect(r.value.rating).toBeLessThan(4.6);
    }
  });

  it('is one review per customer (re-review updates, does not stack)', async () => {
    const owner = await makeUser({ role: 'employer' });
    const customer = await makeUser({ role: 'worker' });
    const shopId = await makeShop(owner.id);

    await shopService.reviewShop({ shopId, authorId: customer.id, rating: 5 });
    await shopService.reviewShop({ shopId, authorId: customer.id, rating: 1 });
    const count = await prisma.shopReview.count({ where: { shopId } });
    expect(count).toBe(1);
  });

  it('rejects an out-of-range rating and a self-review', async () => {
    const owner = await makeUser({ role: 'employer' });
    const customer = await makeUser({ role: 'worker' });
    const shopId = await makeShop(owner.id);

    const bad = await shopService.reviewShop({ shopId, authorId: customer.id, rating: 9 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('VALIDATION');

    const self = await shopService.reviewShop({ shopId, authorId: owner.id, rating: 5 });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe('FORBIDDEN');
  });
});

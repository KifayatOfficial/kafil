// §6 discovery (radius search across pillars) tests. Real Postgres + PostGIS.
//
// Invariants:
//  1. nearby() returns jobs + shops + groups within radius, merged + distance-sorted.
//  2. A far entity (outside radius) is excluded.
//  3. kinds filter narrows the result set.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { shopService } from '../shop.service';
import { communityService } from '../community.service';
import { discoveryService } from '../discovery.service';
import {
  cleanupTestData,
  ensureMasonrySpecialty,
  makeLocation,
  makeUser,
  newKey,
} from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const HOME = { lat: 34.78, lng: 72.36 };
const NEAR = { lat: 34.781, lng: 72.36 }; // ~110m
const FAR = { lat: 34.95, lng: 72.36 }; // ~19km

describe('discovery — nearby across pillars (§6)', () => {
  it('returns nearby jobs, shops, and groups merged + distance-sorted; excludes far', async () => {
    const owner = await makeUser({ role: 'employer' });
    const spec = await ensureMasonrySpecialty();

    // A near job.
    const nearLoc = await makeLocation({ lat: NEAR.lat, lng: NEAR.lng });
    const job = await jobService.createJob({
      employerId: owner.id,
      input: { title: 'near job', location_id: nearLoc.id, headcount: 1, rate_pkr: 3000, rate_unit: 'day', specialty_ids: [spec.id], idempotency_key: newKey(), payment_mode: 'cash' },
    });
    if (!job.ok) throw new Error();

    // A near shop.
    const shopLoc = await makeLocation({ lat: NEAR.lat, lng: NEAR.lng });
    const shop = await shopService.createShop({ ownerId: owner.id, name: 'Near Shop', locationId: shopLoc.id });
    if (!shop.ok) throw new Error();

    // A near group.
    const groupLoc = await makeLocation({ lat: NEAR.lat, lng: NEAR.lng });
    const group = await communityService.createGroup({ creatorId: owner.id, name: 'Near Group', locationId: groupLoc.id });
    if (!group.ok) throw new Error();

    // A FAR job that must be excluded at 5km radius.
    const farLoc = await makeLocation({ lat: FAR.lat, lng: FAR.lng });
    const farJob = await jobService.createJob({
      employerId: owner.id,
      input: { title: 'far job', location_id: farLoc.id, headcount: 1, rate_pkr: 3000, rate_unit: 'day', specialty_ids: [spec.id], idempotency_key: newKey(), payment_mode: 'cash' },
    });
    if (!farJob.ok) throw new Error();

    const res = await discoveryService.nearby({ userId: owner.id, lat: HOME.lat, lng: HOME.lng, radiusM: 5_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ids = res.value.results.map((r) => r.id);
    expect(ids).toContain(job.value.jobId);
    expect(ids).toContain(shop.value.shopId);
    expect(ids).toContain(group.value.groupId);
    expect(ids).not.toContain(farJob.value.jobId); // outside 5km

    // Distance-sorted ascending.
    const dists = res.value.results.map((r) => r.distanceM);
    expect([...dists]).toEqual([...dists].sort((a, b) => a - b));
    // All three kinds present.
    expect(new Set(res.value.results.map((r) => r.kind))).toEqual(new Set(['job', 'shop', 'group']));
  });

  it('kinds filter narrows the result set to shops only', async () => {
    const owner = await makeUser({ role: 'employer' });
    const spec = await ensureMasonrySpecialty();
    const loc = await makeLocation({ lat: NEAR.lat, lng: NEAR.lng });
    await jobService.createJob({
      employerId: owner.id,
      input: { title: 'j', location_id: loc.id, headcount: 1, rate_pkr: 3000, rate_unit: 'day', specialty_ids: [spec.id], idempotency_key: newKey(), payment_mode: 'cash' },
    });
    const shopLoc = await makeLocation({ lat: NEAR.lat, lng: NEAR.lng });
    await shopService.createShop({ ownerId: owner.id, name: 'Only Shop', locationId: shopLoc.id });

    const res = await discoveryService.nearby({ userId: owner.id, lat: HOME.lat, lng: HOME.lng, radiusM: 5_000, kinds: ['shop'] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.results.length).toBeGreaterThan(0);
      expect(res.value.results.every((r) => r.kind === 'shop')).toBe(true);
    }
  });

  it('returns located:false when no point and no base location', async () => {
    const u = await makeUser({ role: 'employer' }); // employer has no worker base location
    const res = await discoveryService.nearby({ userId: u.id });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.located).toBe(false);
  });
});

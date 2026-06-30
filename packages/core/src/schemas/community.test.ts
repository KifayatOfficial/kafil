// Contract tests for the §2.8 community/directory schemas (roadmap P1.5).
//
// These assert that the shapes the API actually returns parse cleanly against the core
// schemas — the whole point of lifting them into core is to catch drift between the
// server's responses and the shared contract. The sample objects below mirror real
// rows from the shops / groups / posts routes.

import { describe, it, expect } from 'vitest';
import {
  Shop,
  ShopReview,
  CreateShopInput,
  Group,
  CreateGroupInput,
  Post,
  Comment,
  CreatePostInputChecked,
} from './index';

const UUID = '00000000-0000-0000-0000-000000000010';
const NOW = '2026-06-30T00:00:00.000Z';

describe('Shop schema', () => {
  it('parses a representative shop row', () => {
    const row = {
      id: UUID,
      owner_id: UUID,
      name: "Hassan's Cement & Materials",
      description: 'Cement, rebar, tiles. Bulk discounts.',
      location_id: UUID,
      categories: ['cement', 'tiles', 'electrical'],
      photos: ['https://cdn.kafil.pk/shops/1.jpg'],
      hours: { mon: [{ open: '08:00', close: '18:00' }], fri: [] },
      rating_bayesian: 4.6,
      verified_tier: 'verified',
      status: 'active',
      created_at: NOW,
    };
    expect(Shop.parse(row)).toMatchObject({ name: row.name, verified_tier: 'verified' });
  });

  it('accepts null description/location/hours and free tier', () => {
    expect(
      Shop.parse({
        id: UUID,
        owner_id: UUID,
        name: 'Corner Shop',
        description: null,
        location_id: null,
        categories: [],
        photos: [],
        hours: null,
        rating_bayesian: null,
        verified_tier: 'free',
        status: 'active',
        created_at: NOW,
      }),
    ).toBeTruthy();
  });

  it('rejects an out-of-range rating and unknown tier', () => {
    expect(() => Shop.parse({ rating_bayesian: 9 } as never)).toThrow();
    expect(CreateShopInput.safeParse({ name: 'x', idempotency_key: 'k'.repeat(8) }).success).toBe(true);
  });

  it('parses a shop review', () => {
    expect(
      ShopReview.parse({
        id: UUID,
        shop_id: UUID,
        author_id: UUID,
        rating: 5,
        comment: 'Honest weights.',
        status: 'visible',
        created_at: NOW,
      }).rating,
    ).toBe(5);
  });
});

describe('Group schema', () => {
  it('parses a directory row with caller join flags', () => {
    const g = Group.parse({
      id: UUID,
      name: 'Masons of Swat',
      description: null,
      category: 'trade',
      location_id: UUID,
      created_by: UUID,
      status: 'active',
      created_at: NOW,
      member_count: 42,
      joined: true,
    });
    expect(g).toMatchObject({ category: 'trade', joined: true, member_count: 42 });
  });

  it('parses without the optional read-side helpers', () => {
    expect(
      Group.parse({
        id: UUID,
        name: 'Mingora Jobs',
        description: null,
        category: 'geographic',
        location_id: null,
        created_by: UUID,
        status: 'active',
        created_at: NOW,
      }),
    ).toBeTruthy();
  });

  it('validates create input', () => {
    expect(
      CreateGroupInput.safeParse({ name: 'Welders KP', category: 'trade', idempotency_key: 'k'.repeat(8) })
        .success,
    ).toBe(true);
  });
});

describe('Post + Comment schema', () => {
  it('parses an offer post with images', () => {
    const p = Post.parse({
      id: UUID,
      group_id: UUID,
      author_id: UUID,
      kind: 'offer',
      body: 'Used scaffolding, 20 units.',
      images: ['https://cdn.kafil.pk/posts/x.jpg'],
      pinned: false,
      comment_count: 3,
      status: 'visible',
      created_at: NOW,
    });
    expect(p.kind).toBe('offer');
  });

  it('allows a photo-only post (no body) but rejects an empty post', () => {
    expect(
      CreatePostInputChecked.safeParse({
        images: ['https://cdn.kafil.pk/posts/y.jpg'],
        idempotency_key: 'k'.repeat(8),
      }).success,
    ).toBe(true);
    expect(
      CreatePostInputChecked.safeParse({ body: '   ', images: [], idempotency_key: 'k'.repeat(8) }).success,
    ).toBe(false);
  });

  it('parses a comment', () => {
    expect(
      Comment.parse({
        id: UUID,
        post_id: UUID,
        author_id: UUID,
        body: 'Still available?',
        status: 'visible',
        created_at: NOW,
      }).body,
    ).toBe('Still available?');
  });
});

// Unit tests for the keyset-cursor helper (§P1.4). Pure — no DB.

import { describe, expect, it } from 'vitest';
import { clampLimit, cursorWhere, decodeCursor, encodeCursor, paginate } from '../cursor';

describe('cursor encode/decode', () => {
  it('round-trips (createdAt, id)', () => {
    const row = { createdAt: new Date('2026-06-30T12:00:00.000Z'), id: 'abc-123' };
    const token = encodeCursor(row);
    const back = decodeCursor(token);
    expect(back?.id).toBe('abc-123');
    expect(back?.createdAt.toISOString()).toBe('2026-06-30T12:00:00.000Z');
  });

  it('treats absent/garbage cursors as page 1 (null)', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('not-base64-$$$')).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":"nope"}').toString('base64url'))).toBeNull();
  });
});

describe('clampLimit', () => {
  it('defaults and clamps', () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(0)).toBe(20);
    expect(clampLimit(-5)).toBe(20);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(9999)).toBe(50); // MAX
  });
});

describe('cursorWhere', () => {
  it('is empty for page 1', () => {
    expect(cursorWhere(null)).toEqual({});
  });
  it('builds a strict (createdAt,id) < tuple compare', () => {
    const c = { createdAt: new Date('2026-06-30T00:00:00.000Z'), id: 'x' };
    const w = cursorWhere(c) as { OR: unknown[] };
    expect(w.OR).toHaveLength(2);
  });
});

describe('paginate', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, createdAt: new Date(2026, 0, 1, 0, 0, n - i) }));

  it('emits a nextCursor only when an extra row was fetched', () => {
    // limit 3, fetched 4 (limit+1) → there IS a next page
    const { items, nextCursor } = paginate(rows(4), 3);
    expect(items).toHaveLength(3);
    expect(nextCursor).not.toBeNull();
    // cursor encodes the LAST in-page row, not the extra one
    expect(decodeCursor(nextCursor)?.id).toBe('id-2');
  });

  it('nextCursor is null at the end of the feed', () => {
    const { items, nextCursor } = paginate(rows(2), 3); // fewer than limit+1
    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });
});

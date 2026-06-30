// §P1.4 — keyset (cursor) pagination helper.
//
// Why keyset, not OFFSET: at 1M rows an `OFFSET 10000 LIMIT 20` makes Postgres scan and
// discard 10k rows per page — O(n) and slower the deeper you go. Keyset pagination seeks
// directly via an indexed WHERE on the sort tuple, so page 500 costs the same as page 1.
// It's also stable under inserts/deletes (no "row shifted, item shown twice" that OFFSET
// suffers), which matters on a live feed.
//
// Convention used across the feeds: order by (createdAt DESC, id DESC) — id breaks ties
// so the tuple is strictly monotonic (createdAt alone isn't unique). The cursor encodes
// the last row's (createdAt, id); the next page is "everything strictly before it".
//
//   Page 1:  no cursor → newest N (+1 to detect a next page)
//   Page k:  cursor=last → WHERE (createdAt,id) < (cursor.createdAt, cursor.id)
//
// The cursor is an opaque base64 string on the wire so clients treat it as a token, not
// a parseable structure (lets us change the internal shape later without breaking apps).

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

/** Encode (createdAt, id) into an opaque cursor token. */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  const raw = JSON.stringify({ t: row.createdAt.toISOString(), i: row.id });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/** Decode a cursor token. Returns null for absent/garbage cursors (treated as page 1). */
export function decodeCursor(cursor: string | null | undefined): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const obj = JSON.parse(raw) as { t?: string; i?: string };
    if (!obj.t || !obj.i) return null;
    const d = new Date(obj.t);
    if (Number.isNaN(d.getTime())) return null;
    return { createdAt: d, id: obj.i };
  } catch {
    return null;
  }
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Clamp a caller-supplied limit into a sane range (defends against huge page requests). */
export function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * Build the Prisma WHERE fragment for "rows strictly before the cursor" under the
 * (createdAt DESC, id DESC) ordering. Returns {} for page 1 (no cursor). Compose into a
 * query's existing `where` with AND.
 */
export function cursorWhere(cursor: DecodedCursor | null): object {
  if (!cursor) return {};
  // (createdAt, id) < (c.createdAt, c.id), expressed as Prisma OR for the tuple compare.
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

/**
 * Given the rows fetched with `take: limit + 1`, split into the page to return and the
 * next cursor. If we got the extra row, there's another page and we emit a cursor from
 * the LAST returned (in-page) row; otherwise nextCursor is null (end of feed).
 */
export function paginate<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    return { items, nextCursor: encodeCursor(last) };
  }
  return { items: rows, nextCursor: null };
}

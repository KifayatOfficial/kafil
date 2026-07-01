// NotificationInboxService — the READ side of §11 notifications.
//
// The write pipeline (notifications.service.ts) fans a notification out across in-app /
// push / SMS / WhatsApp and always writes an in-app Notification row. But until now
// nothing let a user READ that in-app inbox: no list, no unread count, no mark-read. This
// is the re-engagement surface that pairs with push — the badge a user taps into.
//
// Mirrors the chat-unread contract: cheap unread count for a badge, keyset-paginated list
// for the inbox, idempotent mark-read (one + all). Every query is scoped to the caller's
// userId — a notification is private to its recipient. Reads use the existing
// @@index([userId, readAt]) (unread count) and (userId, createdAt) ordering.

import { prisma } from '../lib/db';
import { clampLimit, cursorWhere, decodeCursor, encodeCursor } from '../lib/cursor';
import { ok, type Result } from '../lib/result';

export interface InboxItem {
  id: string;
  type: string;
  priority: string;
  title: string | null;
  body: string | null;
  refType: string | null;
  refId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export const notificationInboxService = {
  /** Keyset-paginated inbox, newest first. `?cursor` + `?limit` like the other feeds. */
  async list(args: {
    userId: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<Result<{ items: InboxItem[]; nextCursor: string | null }>> {
    const limit = clampLimit(args.limit);
    const cursor = decodeCursor(args.cursor);
    const rows = await prisma.notification.findMany({
      where: { userId: args.userId, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        type: true,
        priority: true,
        title: true,
        body: true,
        refType: true,
        refId: true,
        readAt: true,
        createdAt: true,
      },
    });
    // Local paginate (rows already have createdAt+id) — mirror lib/cursor.paginate.
    if (rows.length > limit) {
      const items = rows.slice(0, limit);
      const last = items[items.length - 1]!;
      return ok({ items, nextCursor: encodeCursor(last) });
    }
    return ok({ items: rows, nextCursor: null });
  },

  /** Count of unread (readAt IS NULL) notifications — powers the inbox badge. */
  async unreadCount(userId: string): Promise<Result<{ total: number }>> {
    const total = await prisma.notification.count({
      where: { userId, readAt: null },
    });
    return ok({ total });
  },

  /**
   * Mark one notification read. Scoped by userId so a caller can only read their own; a
   * missing/other-user id simply updates 0 rows (idempotent, never leaks existence).
   * Returns whether a row was actually flipped.
   */
  async markRead(args: { userId: string; id: string }): Promise<Result<{ updated: boolean }>> {
    const res = await prisma.notification.updateMany({
      where: { id: args.id, userId: args.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ updated: res.count > 0 });
  },

  /** Mark every unread notification read. Returns how many were flipped. */
  async markAllRead(userId: string): Promise<Result<{ updated: number }>> {
    const res = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ updated: res.count });
  },
};

// §11 — the notification-inbox badge's data source.
//
// Fetches the caller's unread in-app notification count from
// /api/notifications/unread-count and refreshes it on the SSE hints that correlate with a
// server-side notification write (application.status, assignment.update, nearby.match,
// reaction.new). No timer: the count moves on push and self-heals on the next fetch if a
// hint is missed (the SSE bus is an in-process hint, not authoritative).
//
// Degrades safely: signed-out or offline → the fetch fails and the count stays 0.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useEventStream } from './useEventStream';

export function useNotificationCount(): { count: number; refresh: () => void } {
  const { api, status } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const r = await api.get<{ ok: true; total: number }>('/api/notifications/unread-count');
    if (r.success) setCount((r.data as { total: number }).total);
  }, [api]);

  useEffect(() => {
    if (status !== 'signedIn') {
      setCount(0);
      return;
    }
    void refresh();
  }, [status, refresh]);

  // Any event that the server also turns into a notification → re-pull the count.
  useEventStream(
    {
      'application.status': () => void refresh(),
      'assignment.update': () => void refresh(),
      'nearby.match': () => void refresh(),
      'reaction.new': () => void refresh(),
    },
    status === 'signedIn',
  );

  return { count, refresh };
}

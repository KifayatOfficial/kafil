// §27/1.2 — the live chat badge's data source.
//
// Fetches the caller's total unread message count from /api/conversations/unread-count and
// keeps it fresh by re-fetching whenever a `message.new` SSE hint arrives (the same hint
// transport that drives instant chat). No timer polling: the count moves the instant the
// server pushes, and self-heals on the next fetch if a hint is ever missed (the SSE bus is
// an in-process hint, not authoritative — see useEventStream / event-bus).
//
// Degrades safely: signed-out or offline → the fetch simply fails and the count stays 0
// (no badge), which is the correct "nothing to see" state.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useEventStream } from './useEventStream';

export function useUnreadCount(): { count: number; refresh: () => void } {
  const { api, status } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const r = await api.get<{ ok: true; total: number }>('/api/conversations/unread-count');
    if (r.success) setCount((r.data as { total: number }).total);
  }, [api]);

  // Fetch once the user is signed in, and again each time we (re)mount.
  useEffect(() => {
    if (status !== 'signedIn') {
      setCount(0);
      return;
    }
    void refresh();
  }, [status, refresh]);

  // A new message anywhere the user participates → re-pull the authoritative total.
  useEventStream({ 'message.new': () => void refresh() }, status === 'signedIn');

  return { count, refresh };
}

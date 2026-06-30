// §P4.1 client — subscribe to the server's per-user SSE channel (/api/stream).
//
// Opens a react-native-sse EventSource with the bearer token, auto-reconnects (the lib
// handles backoff), and invokes a handler per named event. The connection is a *hint*
// transport: handlers should trigger a normal REST refetch, never treat the event as
// authoritative data — so a missed/cross-pod event self-heals on the next fetch.
//
// Degrades safely: if there's no token, or the platform/network can't hold the stream,
// the hook simply never fires — callers keep a slow poll as a fallback, so chat/updates
// still work, just less instantly.

import { useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import EventSource from 'react-native-sse';
import { useAuth } from '../auth/AuthContext';

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:3001';

export type StreamEventName =
  | 'message.new'
  | 'application.status'
  | 'assignment.update'
  | 'nearby.match'
  | 'reaction.new';

type Handlers = Partial<Record<StreamEventName, (data: Record<string, unknown>) => void>>;

/**
 * Subscribe to the SSE stream for the lifetime of the calling screen. `handlers` is read
 * through a ref so callers can pass an inline object without re-opening the socket each
 * render. Pass `enabled=false` to hold off (e.g. until a screen is ready).
 */
export function useEventStream(handlers: Handlers, enabled = true): void {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const handlersRef = useRef<Handlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !token) return;

    const names = Object.keys(handlersRef.current) as StreamEventName[];
    const es = new EventSource(`${API_URL}/api/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      // Let the lib manage reconnection; pollingInterval>0 enables auto-reconnect.
      pollingInterval: 5000,
    });

    const subs = names.map((name) => {
      const listener = (event: { type: string; data?: string | null }) => {
        let parsed: Record<string, unknown> = {};
        if (event.data) {
          try {
            parsed = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            // Non-JSON frame (heartbeat/comment) — ignore.
          }
        }
        handlersRef.current[name]?.(parsed);
      };
      // react-native-sse types custom event names loosely; cast to satisfy addEventListener.
      es.addEventListener(name as never, listener as never);
      return { name, listener };
    });

    return () => {
      for (const s of subs) es.removeEventListener(s.name as never, s.listener as never);
      es.close();
    };
  }, [enabled, token]);
}

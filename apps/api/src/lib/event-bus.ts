// §P4.1 — in-process real-time event bus backing the SSE endpoint (/api/stream).
//
// At 1M users, 1M clients polling /messages every 4s is a self-inflicted DDoS. SSE lets
// the server push "something changed for you" the instant it happens. This bus is the
// fan-out primitive: services publish a typed event keyed to a userId; the SSE route
// subscribes per connected user and forwards matching events down the wire.
//
// Scope + honesty: this is IN-PROCESS (one Node process). It's correct and sufficient
// for a single API instance and for tests. Horizontal scale (multiple pods) needs a
// shared transport — Redis pub/sub — which slots in behind this same publish()/subscribe()
// interface with NO call-site changes (the roadmap §4.1 + §5 documents this). Until then,
// the SSE event is only a *hint to refresh*; the REST read remains authoritative, so a
// missed cross-pod event self-heals on the next fetch/reconnect.

export type StreamEventType =
  | 'message.new' // a new chat message in a conversation the user is in
  | 'application.status' // the user's application changed (e.g. accepted → "hired")
  | 'assignment.update' // an assignment the user is party to changed state
  | 'nearby.match' // a fresh nearby job/shop/group matches the user
  | 'reaction.new'; // a reaction landed on the user's content

export interface StreamEvent {
  type: StreamEventType;
  /** The user this event is for (the SSE channel key). */
  userId: string;
  /** Small, non-authoritative hint payload (ids/counts) — clients re-fetch for truth. */
  data?: Record<string, unknown>;
  /** Epoch-ms stamp set at publish time. */
  ts: number;
}

type Listener = (e: StreamEvent) => void;

// userId → set of listeners (one per open SSE connection for that user; a user may have
// several devices/tabs).
const listeners = new Map<string, Set<Listener>>();

/** Subscribe a connection to a user's events. Returns an unsubscribe fn. */
export function subscribe(userId: string, fn: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(userId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(userId);
  };
}

/**
 * Publish an event to a user. Best-effort + non-throwing: a listener that throws must
 * never break the caller's request path (publishing is a side effect of a DB write, not
 * part of its correctness). Safe to call even when no one is listening.
 */
export function publish(event: Omit<StreamEvent, 'ts'> & { ts?: number }): void {
  const set = listeners.get(event.userId);
  if (!set || set.size === 0) return;
  const full: StreamEvent = { ...event, ts: event.ts ?? Date.now() };
  for (const fn of set) {
    try {
      fn(full);
    } catch {
      // Swallow — a bad listener can't poison the publisher.
    }
  }
}

/** Test/diagnostic: how many connections are listening for a user (0 if none). */
export function listenerCount(userId: string): number {
  return listeners.get(userId)?.size ?? 0;
}

/** Test helper: drop all listeners (between test cases). */
export function _resetBus(): void {
  listeners.clear();
}

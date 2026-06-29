// §13 — the mobile outbox provider: binds the pure core engine to this device's
// reality (AsyncStorage persistence, the session's API client, NetInfo connectivity).
//
// Lifecycle:
//   - One Outbox instance per signed-in user (re-created when the user changes so a
//     new user never inherits the previous user's queue).
//   - Hydrates from disk on mount, then subscribes to NetInfo and pushes connectivity
//     into the engine. The engine auto-flushes on the offline→online edge.
//   - Also flushes on app foreground (NetInfo's reachability can lag a resume).
//
// Components consume `useOutbox()` to enqueue mutations and to render queue state
// (the "syncing N actions" / "you're offline" affordances).

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Outbox, type EnqueueInput, type OutboxOp } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { makeOutboxPersistence } from './persistence';

interface OutboxContextValue {
  /** Queue a mutation; returns the persisted op so callers can render optimistic UI. */
  enqueue: (input: EnqueueInput) => Promise<OutboxOp>;
  /** Live queue snapshot (re-renders consumers on every change). */
  ops: readonly OutboxOp[];
  /** Not-yet-terminal ops — what "syncing…" counts. */
  pending: readonly OutboxOp[];
  /** Device connectivity as the engine currently understands it. */
  online: boolean;
  /** Drop terminal ops the UI has acknowledged. */
  prune: (ids?: string[]) => Promise<void>;
}

const Ctx = createContext<OutboxContextValue | null>(null);

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { session, api } = useAuth();
  const userId = session?.userId ?? null;

  const [ops, setOps] = useState<readonly OutboxOp[]>([]);
  const [online, setOnline] = useState(false);

  // Keep a stable ref to the api client so the sender always uses the live token
  // (the client itself rotates tokens internally; we just must not close over a stale instance).
  const apiRef = useRef(api);
  apiRef.current = api;

  // One engine per user. Recreated when userId changes.
  const outbox = useMemo(() => {
    if (!userId) return null;
    return new Outbox({
      persistence: makeOutboxPersistence(userId),
      sender: (op) => {
        const client = apiRef.current;
        // The op id IS the idempotency key (P4) — reused on every retry so the
        // server dedupes. GETs are never queued, so method is always a mutation.
        if (op.method === 'PATCH') return client.patch(op.path, op.body, { idempotencyKey: op.id });
        // POST (and DELETE, routed through post-style request) share the same contract.
        return client.post(op.path, op.body, { idempotencyKey: op.id });
      },
    });
  }, [userId]);

  // Hydrate + subscribe + wire connectivity for the active engine.
  useEffect(() => {
    if (!outbox) {
      setOps([]);
      setOnline(false);
      return;
    }
    let unsubStore: (() => void) | undefined;
    let unsubNet: (() => void) | undefined;
    let appStateSub: { remove: () => void } | undefined;

    (async () => {
      await outbox.hydrate();
      unsubStore = outbox.subscribe(setOps);

      // NetInfo: push connectivity into the engine. We treat "connected AND
      // internetReachable !== false" as online; `null` reachability (unknown) is
      // optimistically online so we attempt a flush rather than stalling forever.
      unsubNet = NetInfo.addEventListener((state) => {
        const reachable =
          !!state.isConnected && state.isInternetReachable !== false;
        setOnline(reachable);
        outbox.setOnline(reachable);
      });
      // Prime current state immediately (addEventListener may not fire synchronously).
      const initial = await NetInfo.fetch();
      const reachable = !!initial.isConnected && initial.isInternetReachable !== false;
      setOnline(reachable);
      outbox.setOnline(reachable);

      // Flush on foreground — reachability can lag a resume from background.
      appStateSub = AppState.addEventListener('change', (s) => {
        if (s === 'active') void outbox.flush();
      });
    })().catch(() => undefined);

    return () => {
      unsubStore?.();
      unsubNet?.();
      appStateSub?.remove();
    };
  }, [outbox]);

  const value = useMemo<OutboxContextValue>(
    () => ({
      enqueue: async (input) => {
        if (!outbox) throw new Error('outbox unavailable: no active session');
        return outbox.enqueue(input);
      },
      ops,
      pending: ops.filter((o) => o.status === 'pending' || o.status === 'sending'),
      online,
      prune: async (ids) => {
        if (outbox) await outbox.prune(ids);
      },
    }),
    [outbox, ops, online],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOutbox(): OutboxContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOutbox must be used inside <OutboxProvider>');
  return ctx;
}

/**
 * Find this user's queued/in-flight op for a given (kind, jobId) so a screen can show
 * "applying…" optimistically and reconcile when the server confirms. Returns the most
 * recent matching non-pruned op, or undefined.
 */
export function findOp(
  ops: readonly OutboxOp[],
  kind: string,
  match: (meta: Record<string, unknown> | undefined) => boolean,
): OutboxOp | undefined {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i]!;
    if (o.kind === kind && match(o.meta)) return o;
  }
  return undefined;
}

// §13 — OFFLINE MUTATION OUTBOX (the "act offline" engine).
//
// The whole point in 2G/3G Swat is being able to *act* offline: apply, accept,
// message. This module is the queue that makes that safe.
//
// Design goals (same philosophy as api-client — all enforced here, not at call sites):
//   - Pure + storage-agnostic + connectivity-agnostic. The engine never imports
//     React-Native, AsyncStorage, or NetInfo. The host injects a `persistence`
//     adapter and tells the engine when it's online (P2 — swappable boundaries).
//   - Idempotency-first (P4). Every queued op carries a stable client-generated
//     Idempotency-Key, reused across every retry, so the server dedupes re-sends.
//     Re-enqueueing the *same* op id is a no-op, never a double-apply.
//   - Server is authoritative (§13/§14). A queued mutation that loses a race
//     (slot filled while offline) resolves to a clear `conflict` outcome via the
//     server's 409 — not a silent failure and never a corrupt double-assign.
//   - Optimistic UI. enqueue() returns synchronously with the op already persisted;
//     the caller renders the intended state immediately and subscribes for the
//     eventual server-confirmed outcome.
//   - Durable. The queue is persisted on every mutation, so a crash/kill mid-flush
//     resumes exactly where it left off — at-least-once delivery, server-deduped to
//     effectively-once.
//
// This is the module the api-client comment ("full outbox is a separate module on
// mobile") promised. It lives in core so web (Capacitor, §13) reuses it unchanged.

import { randomUUID } from '../api-client/uuid';
import type { ApiResult } from '../api-client/index';

/** HTTP verbs the outbox can replay. GETs are never queued — reads don't mutate. */
export type OutboxMethod = 'POST' | 'PATCH' | 'DELETE';

/**
 * Lifecycle of a single queued mutation.
 *   pending   — waiting for a flush (offline, or not yet attempted)
 *   sending   — in flight right now
 *   done      — server accepted (2xx); terminal, eligible for pruning
 *   conflict  — server rejected with 409 (slot filled / stale / duplicate intent);
 *               terminal, server is authoritative — the UI shows a clear resolved state
 *   failed    — exhausted retries on a non-retryable client error (4xx ≠ 409);
 *               terminal, surfaced to the user for manual action
 */
export type OutboxStatus = 'pending' | 'sending' | 'done' | 'conflict' | 'failed';

/** A single queued mutation. `id` doubles as the Idempotency-Key sent to the server. */
export interface OutboxOp {
  /** Client-generated UUID. Stable across retries → the server's Idempotency-Key. */
  id: string;
  method: OutboxMethod;
  path: string;
  body: unknown;
  /**
   * Caller-facing classification of what this op *is* (e.g. 'apply', 'accept',
   * 'message'). Lets the UI label queued items and lets callers find "my pending
   * apply for job X" without parsing the path.
   */
  kind: string;
  /** Opaque caller metadata (e.g. { jobId }). Echoed back on the op; never sent. */
  meta?: Record<string, unknown>;
  status: OutboxStatus;
  /** Number of send attempts made so far. */
  attempts: number;
  /** Epoch-ms of creation (for ordering + stale-op pruning). */
  createdAt: number;
  /** Epoch-ms before which we must not retry (backoff gate). 0 = retry now. */
  nextAttemptAt: number;
  /** Terminal-state detail for the UI: HTTP status + server code/message. */
  outcome?: { status: number; code?: string; message?: string };
}

/** Persistence is injected so the engine stays platform-free (P2). */
export interface OutboxPersistence {
  load(): Promise<OutboxOp[] | null>;
  save(ops: OutboxOp[]): Promise<void>;
}

/**
 * The send primitive. On mobile this is a thin wrapper over KafilApiClient that
 * forwards the op's `id` as the Idempotency-Key. Returns the api-client's
 * ApiResult shape so the engine can classify outcomes uniformly.
 */
export type OutboxSender = (op: OutboxOp) => Promise<ApiResult<unknown>>;

export interface OutboxOptions {
  persistence: OutboxPersistence;
  sender: OutboxSender;
  /** Max send attempts before an op is marked `failed` on transient errors. */
  maxAttempts?: number;
  /** Backoff base in ms; delay = base * 2^(attempts-1), capped by `backoffCapMs`. */
  backoffBaseMs?: number;
  backoffCapMs?: number;
  /** Override clock (tests inject deterministic time). Defaults to Date.now. */
  now?: () => number;
  /** Override id generation (tests inject deterministic ids). */
  idFactory?: () => string;
}

export interface EnqueueInput {
  method: OutboxMethod;
  path: string;
  body?: unknown;
  kind: string;
  meta?: Record<string, unknown>;
  /**
   * Optional explicit op id. Supplying a stable id makes enqueue idempotent at the
   * *client* layer too: enqueueing the same id twice (e.g. a double-tap) returns the
   * existing op instead of creating a second one.
   */
  id?: string;
}

type Listener = (ops: readonly OutboxOp[]) => void;

const DEFAULTS = {
  maxAttempts: 6,
  backoffBaseMs: 1_000,
  backoffCapMs: 5 * 60_000, // 5 min — a worker who comes back online next morning still flushes
};

/**
 * The outbox engine. One instance per signed-in session on the client.
 *
 * Connectivity is pushed in via setOnline(); the engine never polls the network
 * itself. When it flips online it auto-flushes. Callers may also flush() manually
 * (e.g. on app foreground) — flushes are single-flighted so concurrent calls are safe.
 */
export class Outbox {
  private ops: OutboxOp[] = [];
  private listeners = new Set<Listener>();
  private online = false;
  private hydrated = false;
  private flushing = false;
  /** Set when a flush is requested while one is already running — re-runs once after. */
  private flushAgain = false;
  /** The currently-running flush chain, so concurrent callers await real completion. */
  private flushPromise: Promise<void> | null = null;

  private readonly persistence: OutboxPersistence;
  private readonly sender: OutboxSender;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(opts: OutboxOptions) {
    this.persistence = opts.persistence;
    this.sender = opts.sender;
    this.maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
    this.backoffCapMs = opts.backoffCapMs ?? DEFAULTS.backoffCapMs;
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.idFactory ?? (() => randomUUID());
  }

  /** Load the persisted queue. Call once at startup before enqueueing. */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const stored = await this.persistence.load().catch(() => null);
    if (stored && Array.isArray(stored)) {
      // Any op caught mid-flight by a crash is reset to pending so it re-sends.
      // Safe because the server dedupes on the (unchanged) idempotency key.
      this.ops = stored.map((o) => (o.status === 'sending' ? { ...o, status: 'pending' as const } : o));
    }
    this.hydrated = true;
    this.emit();
  }

  /** Current queue snapshot (immutable copy). */
  list(): readonly OutboxOp[] {
    return this.ops.map((o) => ({ ...o }));
  }

  /** Ops not yet in a terminal state — what the UI shows as "syncing". */
  pending(): readonly OutboxOp[] {
    return this.list().filter((o) => o.status === 'pending' || o.status === 'sending');
  }

  /** Subscribe to queue changes. Returns an unsubscribe fn. Fires immediately. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Enqueue a mutation. Persists synchronously-ish (awaitable) and returns the op so
   * the caller can render optimistic UI immediately. Auto-flushes if online.
   *
   * Idempotent on `id`: enqueueing an id that already exists returns the existing op
   * (guards against double-tap / re-render double-submit) without duplicating work.
   */
  async enqueue(input: EnqueueInput): Promise<OutboxOp> {
    const existingById = input.id ? this.ops.find((o) => o.id === input.id) : undefined;
    if (existingById) return { ...existingById };

    const op: OutboxOp = {
      id: input.id ?? this.newId(),
      method: input.method,
      path: input.path,
      body: input.body ?? {},
      kind: input.kind,
      meta: input.meta,
      status: 'pending',
      attempts: 0,
      createdAt: this.now(),
      nextAttemptAt: 0,
    };
    this.ops.push(op);
    await this.persist();
    this.emit();
    // Fire-and-forget flush; callers awaiting the optimistic op shouldn't block on network.
    if (this.online) void this.flush();
    return { ...op };
  }

  /** Tell the engine whether the device has connectivity. Flushes on the offline→online edge. */
  setOnline(online: boolean): void {
    const was = this.online;
    this.online = online;
    if (online && !was) void this.flush();
  }

  isOnline(): boolean {
    return this.online;
  }

  /**
   * Attempt to send every ready op, oldest first. Single-flighted: if called while a
   * flush is running, the engine schedules exactly one more pass afterward (so an
   * enqueue/connectivity change during a flush is never lost). No-op when offline.
   */
  async flush(): Promise<void> {
    if (!this.online) return;
    // Single-flight: a concurrent caller schedules one more pass and awaits the same
    // in-flight chain, so it observes real completion (not an early return).
    if (this.flushing) {
      this.flushAgain = true;
      if (this.flushPromise) await this.flushPromise;
      return;
    }
    this.flushing = true;
    this.flushPromise = (async () => {
      try {
        do {
          this.flushAgain = false;
          await this.flushOnce();
        } while (this.flushAgain && this.online);
      } finally {
        this.flushing = false;
        this.flushPromise = null;
      }
    })();
    await this.flushPromise;
  }

  /** Drop terminal ops (done/conflict/failed). UI calls this after acknowledging them. */
  async prune(ids?: string[]): Promise<void> {
    const isTerminal = (s: OutboxStatus) => s === 'done' || s === 'conflict' || s === 'failed';
    this.ops = this.ops.filter((o) => {
      if (!isTerminal(o.status)) return true;
      if (ids) return !ids.includes(o.id);
      return false;
    });
    await this.persist();
    this.emit();
  }

  // ── internals ───────────────────────────────────────────────────────

  private async flushOnce(): Promise<void> {
    const ready = () =>
      this.ops.find(
        (o) => o.status === 'pending' && o.nextAttemptAt <= this.now(),
      );

    let op = ready();
    while (op && this.online) {
      op.status = 'sending';
      op.attempts += 1;
      await this.persist();
      this.emit();

      let res: ApiResult<unknown> | null = null;
      try {
        res = await this.sender(op);
      } catch {
        res = null; // treat a thrown sender as a network failure
      }

      this.applyResult(op, res);
      await this.persist();
      this.emit();

      op = ready();
    }
  }

  /** Classify a send result into the op's next state. The heart of §13/§14 correctness. */
  private applyResult(op: OutboxOp, res: ApiResult<unknown> | null): void {
    // Network failure (no response): retry with backoff until maxAttempts, then fail.
    if (!res || res.status === 0) {
      this.backoffOrFail(op, { status: 0, code: 'NETWORK' });
      return;
    }

    // 2xx (or server-level success) — terminal success.
    if (res.success || (res.status >= 200 && res.status < 300)) {
      op.status = 'done';
      op.outcome = { status: res.status };
      return;
    }

    const detail = res.data as { code?: string; message?: string } | undefined;

    // 409 — lost a race / duplicate intent. Server is authoritative; do NOT retry.
    if (res.status === 409) {
      op.status = 'conflict';
      op.outcome = { status: 409, code: detail?.code, message: detail?.message };
      return;
    }

    // Other 4xx (validation, auth, not-found) — not transient; retrying won't help.
    if (res.status >= 400 && res.status < 500) {
      op.status = 'failed';
      op.outcome = { status: res.status, code: detail?.code, message: detail?.message };
      return;
    }

    // 5xx — transient server error; retry with backoff.
    this.backoffOrFail(op, { status: res.status, code: detail?.code, message: detail?.message });
  }

  private backoffOrFail(op: OutboxOp, outcome: OutboxOp['outcome']): void {
    if (op.attempts >= this.maxAttempts) {
      op.status = 'failed';
      op.outcome = outcome;
      return;
    }
    const delay = Math.min(this.backoffBaseMs * 2 ** (op.attempts - 1), this.backoffCapMs);
    op.status = 'pending';
    op.nextAttemptAt = this.now() + delay;
    op.outcome = outcome; // keep last transient reason visible while retrying
  }

  private async persist(): Promise<void> {
    await this.persistence.save(this.ops.map((o) => ({ ...o }))).catch(() => {
      // Persistence failure must not crash the flush loop; the in-memory queue is
      // still correct and the next persist will retry. Surfacing is the host's job.
    });
  }

  private emit(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

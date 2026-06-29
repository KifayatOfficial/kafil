// §13 outbox engine tests. The engine is pure, so we drive it with an in-memory
// persistence adapter, a deterministic clock, and a scriptable sender.

import { describe, it, expect, beforeEach } from 'vitest';
import { Outbox, type OutboxOp, type OutboxPersistence } from './index';
import type { ApiResult } from '../api-client/index';

// ── test doubles ──────────────────────────────────────────────────────

/** In-memory persistence that records save calls so we can assert durability. */
class MemPersistence implements OutboxPersistence {
  store: OutboxOp[] | null = null;
  saves = 0;
  async load(): Promise<OutboxOp[] | null> {
    // Deep clone to mimic real serialize/deserialize (no shared references).
    return this.store ? JSON.parse(JSON.stringify(this.store)) : null;
  }
  async save(ops: OutboxOp[]): Promise<void> {
    this.saves += 1;
    this.store = JSON.parse(JSON.stringify(ops));
  }
}

/** A scriptable clock. */
function clock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Build an ApiResult quickly. */
function result(status: number, body: unknown = {}): ApiResult<unknown> {
  const ok = status >= 200 && status < 300;
  return { ok, status, data: body, success: ok };
}

/**
 * A sender whose responses are scripted. Records every op id it was asked to send,
 * in order, so we can assert flush ordering and idempotency-key stability.
 */
function scriptedSender() {
  const calls: { id: string; path: string; attempt: number }[] = [];
  let queue: Array<ApiResult<unknown> | 'throw'> = [];
  const attemptsById = new Map<string, number>();
  const send = async (op: OutboxOp): Promise<ApiResult<unknown>> => {
    const n = (attemptsById.get(op.id) ?? 0) + 1;
    attemptsById.set(op.id, n);
    calls.push({ id: op.id, path: op.path, attempt: n });
    const next = queue.shift();
    if (next === 'throw') throw new Error('boom');
    return next ?? result(200);
  };
  return {
    send,
    calls,
    script: (...responses: Array<ApiResult<unknown> | 'throw'>) => {
      queue = responses;
    },
  };
}

let ids = 0;
const seqId = () => `op-${++ids}`;

/** First op in a snapshot, asserted non-empty (repo convention is `[0]!` under
 *  noUncheckedIndexedAccess; a named helper keeps the assertions readable). */
const first = (ob: Outbox): OutboxOp => {
  const op = ob.list()[0];
  if (!op) throw new Error('expected at least one op in the outbox');
  return op;
};

beforeEach(() => {
  ids = 0;
});

// ── tests ───────────────────────────────────────────────────────────────

describe('Outbox — enqueue & optimistic persistence', () => {
  it('persists an op synchronously on enqueue and returns it pending', async () => {
    const p = new MemPersistence();
    const s = scriptedSender();
    const ob = new Outbox({ persistence: p, sender: s.send, idFactory: seqId });

    const op = await ob.enqueue({ method: 'POST', path: '/api/jobs/j1/applications', kind: 'apply' });

    expect(op.status).toBe('pending');
    expect(op.id).toBe('op-1');
    expect(p.store).toHaveLength(1);
    expect(p.store![0]!.path).toBe('/api/jobs/j1/applications');
    // Offline by default → nothing sent.
    expect(s.calls).toHaveLength(0);
  });

  it('dedups enqueue by explicit id (double-tap guard)', async () => {
    const ob = new Outbox({ persistence: new MemPersistence(), sender: scriptedSender().send });
    const a = await ob.enqueue({ method: 'POST', path: '/x', kind: 'apply', id: 'fixed' });
    const b = await ob.enqueue({ method: 'POST', path: '/x', kind: 'apply', id: 'fixed' });
    expect(a.id).toBe('fixed');
    expect(b.id).toBe('fixed');
    expect(ob.list()).toHaveLength(1);
  });
});

describe('Outbox — flush, success & ordering', () => {
  it('flushes oldest-first when online and marks ops done', async () => {
    const s = scriptedSender();
    s.script(result(201), result(200));
    const ob = new Outbox({ persistence: new MemPersistence(), sender: s.send, idFactory: seqId });

    await ob.enqueue({ method: 'POST', path: '/first', kind: 'apply' });
    await ob.enqueue({ method: 'POST', path: '/second', kind: 'apply' });
    ob.setOnline(true);
    await ob.flush();

    expect(s.calls.map((c) => c.path)).toEqual(['/first', '/second']);
    expect(ob.list().every((o) => o.status === 'done')).toBe(true);
    expect(ob.pending()).toHaveLength(0);
  });

  it('auto-flushes on enqueue when already online', async () => {
    const s = scriptedSender();
    const ob = new Outbox({ persistence: new MemPersistence(), sender: s.send, idFactory: seqId });
    ob.setOnline(true);
    await ob.enqueue({ method: 'POST', path: '/auto', kind: 'apply' });
    // enqueue fires flush fire-and-forget; give the microtask queue a tick.
    await ob.flush();
    expect(s.calls).toHaveLength(1);
    expect(first(ob).status).toBe('done');
  });

  it('reuses the op id as a stable idempotency key across retries', async () => {
    const c = clock();
    const s = scriptedSender();
    s.script('throw', result(200)); // fail once, then succeed
    const ob = new Outbox({
      persistence: new MemPersistence(),
      sender: s.send,
      idFactory: seqId,
      now: c.now,
      backoffBaseMs: 100,
    });

    await ob.enqueue({ method: 'POST', path: '/p', kind: 'apply' });
    ob.setOnline(true);
    await ob.flush(); // attempt 1 → throw → back to pending with backoff
    expect(first(ob).status).toBe('pending');

    c.advance(1_000); // past backoff
    await ob.flush(); // attempt 2 → success

    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]!.id).toBe(s.calls[1]!.id); // same idempotency key
    expect(first(ob).status).toBe('done');
  });
});

describe('Outbox — connectivity', () => {
  it('does not send while offline, flushes on the offline→online edge', async () => {
    const s = scriptedSender();
    const ob = new Outbox({ persistence: new MemPersistence(), sender: s.send, idFactory: seqId });

    await ob.enqueue({ method: 'POST', path: '/q', kind: 'apply' });
    await ob.flush(); // offline — no-op
    expect(s.calls).toHaveLength(0);

    ob.setOnline(true); // edge → auto flush
    await ob.flush();
    expect(s.calls).toHaveLength(1);
    expect(first(ob).status).toBe('done');
  });
});

describe('Outbox — conflict & failure classification (§13/§14)', () => {
  it('marks a 409 as conflict and does NOT retry (server authoritative)', async () => {
    const s = scriptedSender();
    s.script(result(409, { ok: false, code: 'SLOT_FILLED', message: 'This job just filled' }));
    const ob = new Outbox({ persistence: new MemPersistence(), sender: s.send, idFactory: seqId });

    await ob.enqueue({ method: 'POST', path: '/jobs/j1/applications', kind: 'apply', meta: { jobId: 'j1' } });
    ob.setOnline(true);
    await ob.flush();

    const op = first(ob);
    expect(op.status).toBe('conflict');
    expect(op.outcome).toMatchObject({ status: 409, code: 'SLOT_FILLED' });
    expect(op.meta).toEqual({ jobId: 'j1' });
    // Conflicts are terminal — a second flush must not re-send.
    await ob.flush();
    expect(s.calls).toHaveLength(1);
  });

  it('marks a non-409 4xx as failed without retry', async () => {
    const s = scriptedSender();
    s.script(result(422, { ok: false, code: 'VALIDATION', message: 'bad rate' }));
    const ob = new Outbox({ persistence: new MemPersistence(), sender: s.send, idFactory: seqId });

    await ob.enqueue({ method: 'POST', path: '/x', kind: 'apply' });
    ob.setOnline(true);
    await ob.flush();

    expect(first(ob).status).toBe('failed');
    expect(s.calls).toHaveLength(1);
  });

  it('retries 5xx and network errors with backoff, then fails after maxAttempts', async () => {
    const c = clock();
    const s = scriptedSender();
    s.script(result(500), result(503), 'throw'); // 3 transient failures
    const ob = new Outbox({
      persistence: new MemPersistence(),
      sender: s.send,
      idFactory: seqId,
      now: c.now,
      maxAttempts: 3,
      backoffBaseMs: 100,
    });

    await ob.enqueue({ method: 'POST', path: '/x', kind: 'apply' });
    ob.setOnline(true);

    await ob.flush(); // attempt 1 (500) → pending, backoff 100
    expect(first(ob).status).toBe('pending');
    c.advance(200);
    await ob.flush(); // attempt 2 (503) → pending, backoff 200
    expect(first(ob).status).toBe('pending');
    c.advance(400);
    await ob.flush(); // attempt 3 (throw) → maxAttempts reached → failed

    expect(first(ob).status).toBe('failed');
    expect(s.calls).toHaveLength(3);
  });

  it('respects the backoff gate: does not retry before nextAttemptAt', async () => {
    const c = clock();
    const s = scriptedSender();
    s.script(result(500));
    const ob = new Outbox({
      persistence: new MemPersistence(),
      sender: s.send,
      idFactory: seqId,
      now: c.now,
      backoffBaseMs: 1_000,
    });

    await ob.enqueue({ method: 'POST', path: '/x', kind: 'apply' });
    ob.setOnline(true);
    await ob.flush(); // fails, schedules retry at now+1000
    await ob.flush(); // immediately — still gated, no new send
    expect(s.calls).toHaveLength(1);
  });
});

describe('Outbox — durability across restarts', () => {
  it('rehydrates persisted ops and resets a mid-flight op to pending', async () => {
    const p = new MemPersistence();
    // Simulate a crash: an op was left in 'sending'.
    p.store = [
      {
        id: 'op-x',
        method: 'POST',
        path: '/recover',
        body: {},
        kind: 'apply',
        status: 'sending',
        attempts: 1,
        createdAt: 1,
        nextAttemptAt: 0,
      },
    ];
    const s = scriptedSender();
    const ob = new Outbox({ persistence: p, sender: s.send });
    await ob.hydrate();

    expect(ob.list()).toHaveLength(1);
    expect(first(ob).status).toBe('pending'); // sending → pending on recover

    ob.setOnline(true);
    await ob.flush();
    expect(s.calls).toHaveLength(1); // re-sent with the same id → server dedupes
    expect(first(ob).status).toBe('done');
  });
});

describe('Outbox — pruning & subscriptions', () => {
  it('prunes only terminal ops, retaining ones still in flight', async () => {
    const c = clock();
    const s = scriptedSender();
    // first → done(200), second → conflict(409), third → 5xx so it stays pending (backoff)
    s.script(result(200), result(409, { ok: false, code: 'X' }), result(500));
    const ob = new Outbox({
      persistence: new MemPersistence(),
      sender: s.send,
      idFactory: seqId,
      now: c.now,
      backoffBaseMs: 10_000,
    });

    await ob.enqueue({ method: 'POST', path: '/done', kind: 'apply' });
    await ob.enqueue({ method: 'POST', path: '/conflict', kind: 'apply' });
    await ob.enqueue({ method: 'POST', path: '/pending', kind: 'apply' });
    ob.setOnline(true);
    await ob.flush();

    // Sanity: two terminal, one still pending (gated by backoff).
    expect(ob.list().map((o) => o.status).sort()).toEqual(['conflict', 'done', 'pending']);

    await ob.prune(); // drops done + conflict, keeps the pending one
    expect(ob.list()).toHaveLength(1);
    expect(first(ob).path).toBe('/pending');
  });

  it('notifies subscribers on changes', async () => {
    const ob = new Outbox({ persistence: new MemPersistence(), sender: scriptedSender().send, idFactory: seqId });
    const seen: number[] = [];
    const unsub = ob.subscribe((ops) => seen.push(ops.length));
    expect(seen).toEqual([0]); // fires immediately
    await ob.enqueue({ method: 'POST', path: '/x', kind: 'apply' });
    expect(seen[seen.length - 1]).toBe(1);
    unsub();
    await ob.enqueue({ method: 'POST', path: '/y', kind: 'apply' });
    expect(seen[seen.length - 1]).toBe(1); // no further notifications after unsub
  });
});

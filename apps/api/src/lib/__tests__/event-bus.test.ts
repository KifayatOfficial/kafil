// Unit tests for the SSE event bus (§P4.1). Pure in-process — no DB.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { publish, subscribe, listenerCount, _resetBus, type StreamEvent } from '../event-bus';

afterEach(() => _resetBus());

describe('event-bus', () => {
  it('delivers a published event only to the targeted user', () => {
    const aEvents: StreamEvent[] = [];
    const bEvents: StreamEvent[] = [];
    subscribe('user-a', (e) => aEvents.push(e));
    subscribe('user-b', (e) => bEvents.push(e));

    publish({ type: 'message.new', userId: 'user-a', data: { conversationId: 'c1' } });

    expect(aEvents).toHaveLength(1);
    const got = aEvents[0]!;
    expect(got).toMatchObject({ type: 'message.new', userId: 'user-a' });
    expect(got.ts).toBeTypeOf('number');
    expect(bEvents).toHaveLength(0); // strict per-user scoping
  });

  it('supports multiple connections for one user (multi-device)', () => {
    let n = 0;
    subscribe('u', () => (n += 1));
    subscribe('u', () => (n += 1));
    expect(listenerCount('u')).toBe(2);
    publish({ type: 'application.status', userId: 'u' });
    expect(n).toBe(2);
  });

  it('unsubscribe removes the listener and cleans up empty user sets', () => {
    const off = subscribe('u', () => undefined);
    expect(listenerCount('u')).toBe(1);
    off();
    expect(listenerCount('u')).toBe(0);
  });

  it('publishing to a user with no listeners is a no-op (never throws)', () => {
    expect(() => publish({ type: 'nearby.match', userId: 'nobody' })).not.toThrow();
  });

  it('a throwing listener cannot break the publisher or sibling listeners', () => {
    const good = vi.fn();
    subscribe('u', () => {
      throw new Error('bad listener');
    });
    subscribe('u', good);
    expect(() => publish({ type: 'reaction.new', userId: 'u' })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });
});

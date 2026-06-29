// §13 — mobile persistence adapter for the offline outbox.
//
// The queue is non-secret operational state (intended mutations, not tokens), so it
// lives in plain AsyncStorage rather than SecureStore — same split the storage.ts
// header describes. It is namespaced per user so signing in as someone else on a
// shared device never replays the previous user's queued actions.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OutboxOp, OutboxPersistence } from '@kafil/core';

const keyFor = (userId: string) => `kafil.outbox.${userId}`;

export function makeOutboxPersistence(userId: string): OutboxPersistence {
  const key = keyFor(userId);
  return {
    async load(): Promise<OutboxOp[] | null> {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as OutboxOp[]) : null;
      } catch {
        // Corrupt blob — drop it rather than wedging the queue forever.
        return null;
      }
    },
    async save(ops: OutboxOp[]): Promise<void> {
      await AsyncStorage.setItem(key, JSON.stringify(ops));
    },
  };
}

/** Wipe a user's queue (called on sign-out so the device is clean for the next user). */
export async function clearOutbox(userId: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(userId)).catch(() => undefined);
}

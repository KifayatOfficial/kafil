// First-run COACH-MARK engine — the mascot teaching a non-reader how to use the app.
//
// The philosophy (§12/§25): a 55-year-old's first session must need zero reading. A
// coach-mark is a small, dismissible bubble where the mascot points at the primary
// action and (when narration is configured) speaks the tip. Each tip shows AT MOST ONCE
// per user — "seen" keys persist in AsyncStorage so reinstalled guidance never nags.
//
// Screens declare a tip with useCoachMark('home.first_apply'); the engine decides whether
// it's still unseen and returns { show, dismiss }. The actual bubble UI is <CoachMark>.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Stable keys for every once-only coaching moment. Add as flows gain guidance. */
export type CoachMarkKey =
  | 'home.first_apply' // point at a job card: "tap a job to see it and apply"
  | 'home.post_job' // employer: point at the post-job action
  | 'wallet.intro' // what the wallet is
  | 'community.intro'; // what groups are

const STORAGE_KEY = 'kafil.coachMarksSeen';

interface CoachMarkContextValue {
  seen: ReadonlySet<CoachMarkKey>;
  /** True once hydration from disk completes (so we don't flash a tip then hide it). */
  ready: boolean;
  markSeen: (key: CoachMarkKey) => void;
  /** Dev/settings escape hatch: clear all so onboarding coaching replays. */
  reset: () => void;
}

const Ctx = createContext<CoachMarkContextValue | null>(null);

export function CoachMarkProvider({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState<Set<CoachMarkKey>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mounted) return;
        if (raw) {
          try {
            const arr = JSON.parse(raw) as CoachMarkKey[];
            setSeen(new Set(arr));
          } catch {
            // corrupt value → treat as nothing seen
          }
        }
        setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      mounted = false;
    };
  }, []);

  const persist = useCallback((next: Set<CoachMarkKey>) => {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(() => undefined);
  }, []);

  const markSeen = useCallback(
    (key: CoachMarkKey) => {
      setSeen((cur) => {
        if (cur.has(key)) return cur;
        const next = new Set(cur);
        next.add(key);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setSeen(new Set());
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  }, []);

  const value = useMemo<CoachMarkContextValue>(
    () => ({ seen, ready, markSeen, reset }),
    [seen, ready, markSeen, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Declare a once-only coaching tip. Returns whether it should show right now (unseen +
 * hydrated) and a dismiss() that marks it seen. Pass `active=false` to suppress until a
 * screen is ready to teach (e.g. wait for the feed to load).
 */
export function useCoachMark(key: CoachMarkKey, active = true): { show: boolean; dismiss: () => void } {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCoachMark must be used inside <CoachMarkProvider>');
  const show = active && ctx.ready && !ctx.seen.has(key);
  const dismiss = useCallback(() => ctx.markSeen(key), [ctx, key]);
  return { show, dismiss };
}

export function useCoachMarks(): CoachMarkContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCoachMarks must be used inside <CoachMarkProvider>');
  return ctx;
}

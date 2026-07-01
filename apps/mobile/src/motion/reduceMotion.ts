// §27 accessibility (Cloudscape motion research §2) — a single source of truth for
// "should we animate?". Respects the OS reduce-motion setting; when on, entrance/
// celebration animations collapse to 0ms and Lottie shows a static frame. Motion is
// never the only signal (content is perceivable without it), so disabling it is safe.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cached = false; // last known value; hydrated on first mount, kept live by the listener.

/** True when the user has asked the OS to reduce motion. Reactive. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(cached);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        cached = v;
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      cached = v;
      if (alive) setReduce(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Non-hook read for imperative code (e.g. deciding a Lottie loop). Best-effort. */
export function reduceMotionNow(): boolean {
  return cached;
}

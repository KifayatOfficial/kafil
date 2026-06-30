// Reads the OS "reduce motion" accessibility setting and keeps it live. Motion-heavy
// surfaces (the Moment engine, screen transitions) consult this to degrade to a calm
// static + haptic experience for users who've asked the system to minimize animation —
// a real need in the 18–60 audience (vestibular sensitivity, older devices, low vision).
//
// Best-effort: if the platform can't report it, we assume motion is allowed (false),
// matching the app-wide "degrade, don't disable" philosophy.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (mounted) setReduce(!!v);
      })
      .catch(() => undefined);

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => {
      if (mounted) setReduce(!!v);
    });
    return () => {
      mounted = false;
      // RN >= 0.65 returns a subscription with remove(); guard for older shapes.
      sub?.remove?.();
    };
  }, []);

  return reduce;
}

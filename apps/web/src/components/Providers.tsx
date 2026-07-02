'use client';

// App-wide motion configuration. `reducedMotion="user"` makes every Motion component
// automatically honor the OS "reduce motion" accessibility setting by disabling
// transform/layout animations — so we set it once here instead of guarding every
// component (the individual primitives still add their own guards for stagger delays,
// which MotionConfig alone doesn't cover).

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// §27 (Cloudscape motion research §2) — reusable ENTRANCE animations so every screen
// gets consistent, smooth appearance motion instead of ad-hoc per-screen code. Built on
// Reanimated's layout-animation presets and mapped to KAFIL's named curves + timing
// roles. All respect reduce-motion (pass reduce=true → no animation).
//
// Transform patterns mirror Cloudscape's four: fade, scale (via FadeIn's built-in
// scale-less fade + our press-scale elsewhere), slide (FadeInDown/Up/Left/Right), and
// a staggered list entrance (each row delayed by index) — the "detailed, smooth" feel.
//
// Usage:
//   <Animated.View entering={fadeInUp(reduce)}>…</Animated.View>
//   <Animated.View entering={listItemIn(reduce, index)}>…</Animated.View>

import {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeInRight,
  FadeOut,
  type BaseAnimationBuilder,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { motion } from '@kafil/core';

type Entering = BaseAnimationBuilder | typeof BaseAnimationBuilder | EntryExitAnimationFunction;

// Reanimated presets take a duration; the named cubic-beziers aren't directly settable on
// the presets in 3.10, so we approximate curve A (responsive) via preset defaults + our
// timing roles. Springs (usePressScale) carry the expressive feel for interactions.
const T = motion.motionTiming;

/** A no-op "entering" when motion is reduced — the view just appears. */
function still(): undefined {
  return undefined;
}

/** Simple fade — the safest, most universal entrance (Cloudscape's most-used pattern). */
export function fadeIn(reduce: boolean): Entering | undefined {
  return reduce ? still() : FadeIn.duration(T.responsive);
}

/** Fade + slide up from below — for cards/sheets rising into place. */
export function fadeInUp(reduce: boolean): Entering | undefined {
  return reduce ? still() : FadeInUp.duration(T.complex).springify().damping(20);
}

/** Fade + slide down from above — for toasts/banners entering from the top edge. */
export function fadeInDown(reduce: boolean): Entering | undefined {
  return reduce ? still() : FadeInDown.duration(T.complex);
}

/** Fade + slide from the right — RTL-aware callers can flip; used for detail pushes. */
export function fadeInRight(reduce: boolean): Entering | undefined {
  return reduce ? still() : FadeInRight.duration(T.expressive);
}

/** Fade out — matched exit for dismissible elements. */
export function fadeOut(reduce: boolean): Entering | undefined {
  return reduce ? still() : FadeOut.duration(T.responsive);
}

/**
 * Staggered list-item entrance: each row fades+rises with a per-index delay, capped so a
 * long list doesn't wait seconds. This is what makes a feed feel "alive" on open without
 * being gratuitous. Delay caps at 10 items (§27.5 low-end budget).
 */
export function listItemIn(reduce: boolean, index: number): Entering | undefined {
  if (reduce) return still();
  const delay = Math.min(index, 10) * 40;
  return FadeInUp.duration(T.responsive).delay(delay);
}

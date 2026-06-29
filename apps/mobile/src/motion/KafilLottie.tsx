// §27 — single Lottie component used by both class-D rewards and class-E mascot.
// In dev we ship placeholder JSONs; production swaps these for designer assets via
// the Lottielab pipeline (§27.4).

import { useEffect } from 'react';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { motion } from '@kafil/core';

type Variant = 'full' | 'lite' | 'static';

interface Props {
  source: AnimationObject;
  /** §27.3 class — informs default duration cap & whether autoplay loops. */
  motionClass: motion.MotionClass;
  variant?: Variant;
  loop?: boolean;
  autoPlay?: boolean;
  // Style is passed straight through to LottieView. We avoid importing the host's
  // ViewStyle type because two React/RN versions exist in the monorepo and the types
  // diverge; the value itself is just a styling object Metro forwards to native.
  style?: unknown;
  /** Optional: fire when a class-D reward completes (e.g. to nav forward). */
  onFinish?: () => void;
}

export function KafilLottie({
  source,
  motionClass,
  variant = 'full',
  loop,
  autoPlay = true,
  style,
  onFinish,
}: Props) {
  // tier_c devices: bail out entirely. The parent renders a static fallback.
  // (Real tier detection is wired in §27.5 — placeholder for now.)
  if (variant === 'static') return null;

  const isMascot = motionClass === motion.MotionClass.E_MASCOT;
  const shouldLoop = loop ?? (isMascot || motionClass === motion.MotionClass.F_LOADING);

  useEffect(() => {
    if (onFinish && !shouldLoop) {
      // Lottie's onAnimationFinish is bound below; this is a safety guard for unmount.
    }
  }, [onFinish, shouldLoop]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lottieStyle = style as any;
  return (
    <LottieView
      source={source}
      autoPlay={autoPlay}
      loop={shouldLoop}
      style={lottieStyle}
      onAnimationFinish={shouldLoop ? undefined : onFinish}
      // §27.5 — disable hardware-accelerated paths on lite to avoid GPU stalls on tier_b.
      renderMode={variant === 'lite' ? 'SOFTWARE' : 'AUTOMATIC'}
    />
  );
}

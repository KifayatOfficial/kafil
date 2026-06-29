// §27.3 — class-A native press, class-B state flip helpers.
// Class C transitions live with the navigator (react-navigation springs).
// Class D rewards + class E mascot reactions use Lottie via <KafilLottie>.

import { motion } from '@kafil/core';
import {
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** Class A — micro press. Spring is on UI thread (worklet-friendly). */
export function usePressScale(): {
  scale: SharedValue<number>;
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const scale = useSharedValue(1);
  return {
    scale,
    onPressIn: () => {
      scale.value = withSpring(0.96, motion.motionEasing.springResponsive);
    },
    onPressOut: () => {
      scale.value = withSpring(1, motion.motionEasing.springDefault);
    },
  };
}

/** Class B — state-change flash (e.g. application status update). */
export function useStateFlash(): { opacity: SharedValue<number>; flash: () => void } {
  const opacity = useSharedValue(1);
  const flash = () => {
    opacity.value = withTiming(0.6, { duration: motion.motionDuration.xs });
    setTimeout(() => {
      opacity.value = withTiming(1, { duration: motion.motionDuration.sm });
    }, motion.motionDuration.xs);
  };
  return { opacity, flash };
}

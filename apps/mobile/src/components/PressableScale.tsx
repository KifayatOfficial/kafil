// <PressableScale> — the "everything responds to touch" primitive (§27.3 Class-A).
//
// 13 screens hand-roll the same combo: usePressScale() + <Pressable> + <Animated.View>
// with a scale transform + a haptic on press-in. This consolidates it into one component
// so every tappable surface in the app springs under the finger consistently — the
// ambient "this app is alive" feel — without each call site re-wiring three pieces.
//
//   <PressableScale onPress={open} haptic="tap_light" accessibilityLabel="Open job">
//     <JobCardBody ... />
//   </PressableScale>
//
// Honors reduce-motion (no scale, just the press) and degrades haptics to no-op on
// devices without them. Forwards the usual Pressable props.

import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { motion } from '@kafil/core';
import { usePressScale } from '../motion/animations';
import { useReduceMotion } from '../theme';
import { haptic as fireHaptic } from '../motion/feedback';

interface Props extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Haptic token fired on press-in. Defaults to a light tap; pass null to silence. */
  haptic?: motion.HapticToken | null;
  /** How far to scale on press (default 0.96, matching the app's existing feel). */
}

export function PressableScale({ children, style, haptic = motion.hapticToken.TAP_LIGHT, onPressIn, onPressOut, ...rest }: Props) {
  const reduceMotion = useReduceMotion();
  const { scale, onPressIn: scaleIn, onPressOut: scaleOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={(e) => {
        if (!reduceMotion) scaleIn();
        if (haptic) void fireHaptic(haptic);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotion) scaleOut();
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[style as ViewStyle, reduceMotion ? undefined : animated]}>{children}</Animated.View>
    </Pressable>
  );
}

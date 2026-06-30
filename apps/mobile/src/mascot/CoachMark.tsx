// <CoachMark> — the bubble the coach-mark engine shows: a pointing mascot + a short
// message, dismissed by tapping anywhere on it. Spring-fades in (Class-B), respects
// reduce-motion, and is fully self-contained so a screen drops one in conditionally:
//
//   const { show, dismiss } = useCoachMark('home.first_apply', jobs !== null);
//   {show ? <CoachMark message={t('coach.first_apply')} onDismiss={dismiss} /> : null}

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { motion } from '@kafil/core';
import { useTheme, useReduceMotion } from '../theme';
import { haptic } from '../motion/feedback';
import { Mascot } from './Mascot';

interface Props {
  message: string;
  onDismiss: () => void;
  /** Where it sits on screen. 'bottom' (above a CTA/tab bar) or 'center'. */
  placement?: 'bottom' | 'center';
}

export function CoachMark({ message, onDismiss, placement = 'bottom' }: Props) {
  const { colors, radius, spacing, type, elevation } = useTheme();
  const reduceMotion = useReduceMotion();

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduceMotion ? 0 : 14);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 220 });
    if (!reduceMotion) translateY.value = withSpring(0, motion.motionEasing.springResponsive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const dismiss = () => {
    void haptic(motion.hapticToken.TAP_LIGHT);
    onDismiss();
  };

  return (
    <View
      style={[StyleSheet.absoluteFill, placement === 'bottom' ? styles.anchorBottom : styles.anchorCenter]}
      pointerEvents="box-none"
    >
      <Animated.View style={anim}>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={message}
          style={[
            styles.bubble,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.primarySoft,
              borderRadius: radius.xl,
              padding: spacing.md,
              gap: spacing.sm,
            },
            elevation(3),
          ]}
        >
          <Mascot pose="point" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: colors.text }]}>{message}</Text>
            <Text style={[type.caption, { color: colors.textFaint, marginTop: 2 }]}>👆</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchorBottom: { justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 96 },
  anchorCenter: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  bubble: { flexDirection: 'row', alignItems: 'center', maxWidth: 420, borderWidth: 1 },
});

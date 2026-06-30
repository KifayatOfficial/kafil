// A one-tap, icon-only light/dark control. No text to read (§12 low-literacy): the glyph
// shows the *current* mode — ☀️ light, 🌙 dark, 🌗 follow-system — and tapping cycles
// system → light → dark. Class-A press feedback + a light haptic, like every other
// interactive surface in the app.

import { Pressable, Text } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { motion } from '@kafil/core';
import { useTheme } from './ThemeContext';
import { makeStyles } from './makeStyles';

const GLYPH: Record<string, string> = { system: '🌗', light: '☀️', dark: '🌙' };

export function ThemeToggle({ accessibilityLabel }: { accessibilityLabel?: string }) {
  const { mode, cycleMode } = useTheme();
  const styles = useStyles();
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={() => {
        void haptic(motion.hapticToken.TAP_LIGHT);
        cycleMode();
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Theme: ${mode}`}
    >
      <Animated.View style={[styles.btn, animated]}>
        <Text style={styles.icon}>{GLYPH[mode]}</Text>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  btn: {
    width: 40,
    height: 40,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  icon: { fontSize: 18 },
}));

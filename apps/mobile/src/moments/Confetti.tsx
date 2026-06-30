// Lightweight confetti for Class-D moments — pure Reanimated, zero extra deps and zero
// Lottie budget (§27.4 forbids Lottie for anything we can do with native springs). A
// fixed set of particles bursts upward from center, fans out, and falls under "gravity"
// while fading. Particle count is modest so it stays smooth on low-end Androids; callers
// that hit the device-tier cap (§27.5) or reduce-motion simply don't render this.

import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';

const COUNT = 14;

export function Confetti({ tone }: { tone: string }) {
  const { width, height } = useWindowDimensions();
  const { colors } = useTheme();
  // A small palette so confetti reads as celebratory, not monochrome.
  const palette = [tone, colors.accent, colors.primary, colors.info, colors.warning];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: COUNT }, (_, i) => (
        <Particle
          key={i}
          index={i}
          originX={width / 2}
          originY={height / 2}
          color={palette[i % palette.length]}
          fallTo={height + 40}
        />
      ))}
    </View>
  );
}

function Particle({
  index,
  originX,
  originY,
  color,
  fallTo,
}: {
  index: number;
  originX: number;
  originY: number;
  color: string;
  fallTo: number;
}) {
  const progress = useSharedValue(0);

  // Deterministic per-index spread (no Math.random — keeps it replay-stable and avoids
  // the banned RNG). Angle fans across a fountain; horizontal drift varies by index.
  const angle = (index / COUNT) * Math.PI - Math.PI / 2; // -90°..+90°
  const driftX = Math.cos(angle) * (60 + (index % 5) * 22);
  const riseY = -(120 + (index % 4) * 40);
  const delay = (index % 6) * 35;

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // Up-then-down arc: rise in the first 40%, fall after.
    const arcY = p < 0.4 ? riseY * (p / 0.4) : riseY + (fallTo - originY - riseY) * ((p - 0.4) / 0.6);
    return {
      transform: [
        { translateX: driftX * p },
        { translateY: arcY },
        { rotate: `${p * 540 + index * 25}deg` },
        { scale: 1 - p * 0.3 },
      ],
      opacity: p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15,
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        { left: originX - 5, top: originY, backgroundColor: color, borderRadius: index % 2 ? 2 : 5 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', width: 10, height: 10 },
});

// §27 class-F loading skeleton. A shimmer-pulse placeholder shown while content loads,
// so screens feel instant instead of blank-then-pop. Pure reanimated (no Lottie needed
// for a pulse — Lottie is reserved for richer class-D/E moments); the budget for F is
// "cheap and ambient" per §27.3.
//
// Usage:
//   {items === null ? <SkeletonList rows={5} /> : items.map(...)}

import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { motion } from '@kafil/core';

export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.block, style, anim]} />;
}

/** A card-shaped skeleton row matching the job/conversation card silhouette. */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <SkeletonBlock style={{ width: '60%', height: 16 }} />
      <SkeletonBlock style={{ width: '40%', height: 12, marginTop: 8 }} />
    </View>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: '#e6e0d8', borderRadius: motion.radius.sm },
  card: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: motion.spacing.lg,
    marginVertical: motion.spacing.sm,
  },
});

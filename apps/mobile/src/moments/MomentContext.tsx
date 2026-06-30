// §27 Class-D — the MOMENT HOST + useMoment() hook.
//
// Mounted once at the router root. Any screen calls `celebrate('hired')` (optionally
// with overrides) and the host plays a full-screen, non-blocking celebration over the
// top of whatever is showing: a spring-in card with the moment glyph, confetti, a
// haptic crescendo, a sound (when assets exist), and an auto-dismiss timed to the
// Class-D budget. A queue serializes back-to-back moments so two never collide.
//
// Degradation (the app-wide contract): reduce-motion → no animation, the card simply
// fades in and out with a haptic (still a beat, just calm). Everything is best-effort;
// a failed sound or haptic never breaks the visual, and the visual never blocks taps
// underneath once it's dismissing.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { motion } from '@kafil/core';
import { useTheme, useReduceMotion } from '../theme';
import { haptic } from '../motion/feedback';
import { Confetti } from './Confetti';
import { playSound } from './sound';
import { MOMENTS, type MomentDef, type MomentKey } from './registry';

export interface CelebrateOptions {
  /** Override the registry copy (e.g. inject the amount paid, the worker's name). */
  title?: string;
  subtitle?: string;
  /** Called when the user taps the share action (only shown when the moment is shareable). */
  onShare?: () => void;
}

interface MomentContextValue {
  celebrate: (key: MomentKey, opts?: CelebrateOptions) => void;
}

const Ctx = createContext<MomentContextValue | null>(null);

interface ActiveMoment {
  key: MomentKey;
  def: MomentDef;
  opts: CelebrateOptions;
}

export function MomentProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveMoment | null>(null);
  const queue = useRef<ActiveMoment[]>([]);

  const celebrate = useCallback((key: MomentKey, opts: CelebrateOptions = {}) => {
    const def = MOMENTS[key];
    if (!def) return;
    const item: ActiveMoment = { key, def, opts };
    // If one is already showing, queue this so we never stack two cards.
    setActive((cur) => {
      if (cur) {
        queue.current.push(item);
        return cur;
      }
      return item;
    });
  }, []);

  const handleDismiss = useCallback(() => {
    setActive(() => queue.current.shift() ?? null);
  }, []);

  const value = useMemo<MomentContextValue>(() => ({ celebrate }), [celebrate]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active ? (
        <MomentOverlay
          // key forces a fresh mount per moment so its enter animation always runs.
          key={`${active.key}-${queue.current.length}`}
          moment={active}
          onDismiss={handleDismiss}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function MomentOverlay({ moment, onDismiss }: { moment: ActiveMoment; onDismiss: () => void }) {
  const { colors, radius, spacing, type, elevation } = useTheme();
  const reduceMotion = useReduceMotion();
  const { def, opts } = moment;

  const tone = colors[def.tone];
  const toneSoft = colors[`${def.tone}Soft` as keyof typeof colors] as string;

  const opacity = useSharedValue(0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.8);

  useEffect(() => {
    // Fire haptic + sound on entry (best-effort; both degrade to no-op).
    void haptic(def.haptic);
    void playSound(def.sound);

    if (reduceMotion) {
      // Calm path: fade in, hold, fade out — no spring, no scale pop.
      opacity.value = withSequence(
        withTiming(1, { duration: 160 }),
        withDelay(def.durationMs, withTiming(0, { duration: 220 }, (done) => {
          if (done) runOnJS(onDismiss)();
        })),
      );
      return;
    }

    opacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withSpring(1.04, motion.motionEasing.springResponsive),
      withSpring(1, motion.motionEasing.springDefault),
    );
    // Auto-dismiss after the budgeted duration.
    opacity.value = withDelay(
      def.durationMs,
      withTiming(0, { duration: 240 }, (done) => {
        if (done) runOnJS(onDismiss)();
      }),
    );

    return () => {
      cancelAnimation(opacity);
      cancelAnimation(scale);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value * 0.5 }));

  const title = opts.title ?? def.title;
  const subtitle = opts.subtitle ?? def.subtitle;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Tap-anywhere-to-dismiss backdrop. Non-blocking once faded. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdropStyle]}
        pointerEvents="auto"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss" />
      </Animated.View>

      {!reduceMotion ? <Confetti tone={tone} /> : null}

      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radius.xl,
              borderColor: toneSoft,
              padding: spacing.xl,
            },
            elevation(4),
            cardStyle,
          ]}
          accessibilityRole="alert"
          accessibilityLabel={`${title}. ${subtitle}`}
        >
          <View style={[styles.glyphWrap, { backgroundColor: toneSoft, borderRadius: radius.pill }]}>
            <Text style={styles.glyph}>{def.glyph}</Text>
          </View>
          <Text style={[type.h2, { color: colors.text, textAlign: 'center', marginTop: spacing.md }]}>
            {title}
          </Text>
          <Text
            style={[type.body, { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs }]}
          >
            {subtitle}
          </Text>

          {def.shareable && opts.onShare ? (
            <Pressable
              onPress={() => {
                void haptic(motion.hapticToken.TAP_LIGHT);
                opts.onShare?.();
              }}
              style={[styles.shareBtn, { backgroundColor: tone, borderRadius: radius.pill, marginTop: spacing.lg }]}
              accessibilityRole="button"
            >
              <Text style={[type.button, { color: colors.textOnPrimary }]}>↗  Share</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

export function useMoment(): MomentContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMoment must be used inside <MomentProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  card: { width: '100%', maxWidth: 360, alignItems: 'center', borderWidth: 1 },
  glyphWrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 40 },
  shareBtn: { paddingHorizontal: 28, paddingVertical: 12 },
});

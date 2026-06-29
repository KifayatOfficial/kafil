// First onboarding screen. Pashto-first (RTL), large tap targets, mascot above.
// Class A press feedback on every interactive surface (§27.3).
// Voice prompt button per §25.1 (audio file integrates later — placeholder Pressable now).

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface Props {
  onOtpSent: (phoneE164: string) => void;
}

export function PhoneEntryScreen({ onOtpSent }: Props) {
  const { requestOtp } = useAuth();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pakistani format helpers — the user types 10 digits (e.g. 3001234567) and we
  // present it as +92 30X XXX XXXX. Server requires the +92XXXXXXXXXX form.
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const e164 = digits.length === 10 ? `+92${digits}` : '';
  const canSubmit = !!e164 && !busy;

  const { scale, onPressIn, onPressOut } = usePressScale();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    try {
      await requestOtp(e164);
      onOtpSent(e164);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'OTP request failed');
      void haptic(motion.hapticToken.ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.E_MASCOT} style={styles.mascot} loop />

      <Text style={styles.title}>{i18n.t('ps', 'onboarding.welcome')}</Text>
      <Text style={styles.subtitle}>+92 — Pakistan</Text>

      <View style={styles.phoneRow}>
        <Text style={styles.cc}>+92</Text>
        <TextInput
          accessibilityLabel="phone number"
          style={styles.input}
          value={digits}
          onChangeText={setRaw}
          placeholder="3001234567"
          keyboardType="number-pad"
          autoComplete="tel"
          maxLength={10}
          textContentType="telephoneNumber"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={submit}
        onPressIn={() => {
          onPressIn();
          void haptic(motion.hapticToken.TAP_LIGHT);
        }}
        onPressOut={onPressOut}
        disabled={!canSubmit}
      >
        <Animated.View style={[styles.cta, !canSubmit && styles.ctaDisabled, animatedStyle]}>
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.ctaText}>{i18n.t('ps', 'common.continue')}</Text>
          )}
        </Animated.View>
      </Pressable>

      <Text style={styles.help}>
        We will send a 6-digit code to your phone. Standard SMS rates may apply.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: motion.color.bg,
    paddingHorizontal: 24,
    paddingTop: 60,
    alignItems: 'center',
  },
  mascot: { width: 120, height: 120 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: motion.color.text,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: { color: '#888', marginTop: 6, marginBottom: 32 },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    paddingHorizontal: motion.spacing.lg,
    width: '100%',
  },
  cc: { fontSize: 18, color: motion.color.text, marginRight: motion.spacing.sm },
  input: { flex: 1, fontSize: 20, color: motion.color.text, paddingVertical: 14 },
  error: { color: motion.color.danger, marginTop: 12, textAlign: 'center' },
  cta: {
    backgroundColor: motion.color.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: motion.radius.pill,
    marginTop: 24,
    minWidth: 220,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#bbb' },
  ctaText: { color: 'white', fontWeight: '700', fontSize: 18 },
  help: {
    color: '#888',
    fontSize: 12,
    marginTop: 24,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});

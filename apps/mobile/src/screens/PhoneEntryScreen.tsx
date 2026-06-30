// First onboarding screen. Pashto-first (RTL), large tap targets, mascot above.
// Class A press feedback on every interactive surface (§27.3).
// §25.1 — recorded narration: autoplays the welcome prompt on enter, with a 🔊
// replay button. Both no-op gracefully until recordings are configured (voiceBaseUrl).

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
import { VoicePromptButton, useVoicePrompt } from '../voice/VoicePromptButton';
import { makeStyles, useTheme } from '../theme';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface Props {
  onOtpSent: (phoneE164: string) => void;
}

export function PhoneEntryScreen({ onOtpSent }: Props) {
  const { requestOtp, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  useVoicePrompt('onboarding.welcome');
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

      <View style={styles.titleRow}>
        <Text style={styles.title}>{i18n.t(lang, 'onboarding.welcome')}</Text>
        <VoicePromptButton promptKey="onboarding.welcome" accessibilityLabel={i18n.t(lang, 'voice.replay')} />
      </View>
      <Text style={styles.subtitle}>+92 — Pakistan</Text>

      <View style={styles.phoneRow}>
        <Text style={styles.cc}>+92</Text>
        <TextInput
          accessibilityLabel="phone number"
          style={styles.input}
          value={digits}
          onChangeText={setRaw}
          placeholder="3001234567"
          placeholderTextColor={colors.textFaint}
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
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.ctaText}>{i18n.t(lang, 'common.continue')}</Text>
          )}
        </Animated.View>
      </Pressable>

      <Text style={styles.help}>{i18n.t(lang, 'onboarding.sms_notice')}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.bg,
    paddingHorizontal: t.spacing.xl,
    paddingTop: 60,
    alignItems: 'center',
  },
  mascot: { width: 120, height: 120 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: t.spacing.lg,
  },
  title: {
    ...t.type.h1,
    color: t.colors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  subtitle: { ...t.type.body, color: t.colors.textMuted, marginTop: t.spacing.xs, marginBottom: t.spacing.xl },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    paddingHorizontal: t.spacing.lg,
    width: '100%',
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  cc: { fontSize: 18, color: t.colors.text, marginEnd: t.spacing.sm },
  input: { flex: 1, fontSize: 20, color: t.colors.text, paddingVertical: t.spacing.md },
  error: { ...t.type.body, color: t.colors.danger, marginTop: t.spacing.md, textAlign: 'center' },
  cta: {
    backgroundColor: t.colors.primary,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xxl,
    borderRadius: t.radius.pill,
    marginTop: t.spacing.xl,
    minWidth: 220,
    alignItems: 'center',
    ...t.elevation(2),
  },
  ctaDisabled: { backgroundColor: t.colors.borderStrong, ...t.elevation(0) },
  ctaText: { ...t.type.label, color: t.colors.textOnPrimary, fontSize: 18 },
  help: {
    ...t.type.caption,
    color: t.colors.textMuted,
    marginTop: t.spacing.xl,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
}));

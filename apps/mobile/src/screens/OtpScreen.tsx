// OTP entry screen. 6-digit code; auto-submits when the 6th digit lands.
// Cooldown banner per §24/A1 is rendered after verify success in the home flow,
// not here — this screen only handles "did the code match".

import { useEffect, useRef, useState } from 'react';
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
import { VoicePromptButton, useVoicePrompt } from '../voice/VoicePromptButton';
import { makeStyles, useTheme } from '../theme';

interface Props {
  phoneE164: string;
  onBack: () => void;
  onVerified: (info: { userId: string; isNew: boolean; cooldown: boolean }) => void;
}

export function OtpScreen({ phoneE164, onBack, onVerified }: Props) {
  const { verifyOtp, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  useVoicePrompt('onboarding.otp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const submit = async (otp: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const info = await verifyOtp(phoneE164, otp);
      void haptic(motion.hapticToken.SUCCESS);
      onVerified(info);
    } catch (e: unknown) {
      void haptic(motion.hapticToken.ERROR);
      setError(e instanceof Error ? e.message : 'verification failed');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onChange = (next: string) => {
    const cleaned = next.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    setError(null);
    if (cleaned.length === 6) void submit(cleaned);
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} hitSlop={16} style={styles.back} accessibilityLabel={i18n.t(lang, 'common.back')}>
        <Text style={{ color: colors.primary, fontSize: 18 }}>←</Text>
      </Pressable>

      <View style={styles.titleRow}>
        <Text style={styles.title}>{i18n.t(lang, 'onboarding.otp_title')}</Text>
        <VoicePromptButton promptKey="onboarding.otp" accessibilityLabel={i18n.t(lang, 'voice.replay')} />
      </View>
      <Text style={styles.subtitle}>{phoneE164}</Text>

      {/* Six boxes that visually mirror the 6-digit code. The single TextInput
          underneath captures the actual input — keeps autofill + keyboard correct. */}
      <View style={styles.boxes}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.box, i < code.length && styles.boxFilled]}>
            <Text style={styles.boxText}>{code[i] ?? ''}</Text>
          </View>
        ))}
      </View>

      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        maxLength={6}
        // Hide the visible input — the boxes above are the UI.
        style={styles.hiddenInput}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} /> : null}

      <Pressable
        onPress={() => void submit(code)}
        onPressIn={() => {
          onPressIn();
          void haptic(motion.hapticToken.TAP_LIGHT);
        }}
        onPressOut={onPressOut}
        disabled={code.length !== 6 || busy}
      >
        <Animated.View
          style={[styles.cta, (code.length !== 6 || busy) && styles.ctaDisabled, animated]}
        >
          <Text style={styles.ctaText}>{i18n.t(lang, 'common.continue')}</Text>
        </Animated.View>
      </Pressable>
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
  back: { alignSelf: 'flex-start', padding: t.spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: t.spacing.xl },
  title: { ...t.type.h2, color: t.colors.text, flexShrink: 1 },
  subtitle: { ...t.type.body, color: t.colors.textMuted, marginTop: t.spacing.xs, marginBottom: t.spacing.xl },
  boxes: { flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.sm },
  box: {
    width: 44,
    height: 56,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  boxFilled: { borderColor: t.colors.primary },
  boxText: { fontSize: 24, fontWeight: '700', color: t.colors.text },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
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
}));

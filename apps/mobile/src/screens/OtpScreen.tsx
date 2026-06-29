// OTP entry screen. 6-digit code; auto-submits when the 6th digit lands.
// Cooldown banner per §24/A1 is rendered after verify success in the home flow,
// not here — this screen only handles "did the code match".

import { useEffect, useRef, useState } from 'react';
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

interface Props {
  phoneE164: string;
  onBack: () => void;
  onVerified: (info: { userId: string; isNew: boolean; cooldown: boolean }) => void;
}

export function OtpScreen({ phoneE164, onBack, onVerified }: Props) {
  const { verifyOtp } = useAuth();
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
      <Pressable onPress={onBack} hitSlop={16} style={styles.back}>
        <Text style={{ color: motion.color.primary, fontSize: 18 }}>←</Text>
      </Pressable>

      <Text style={styles.title}>Enter the 6-digit code</Text>
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
      {busy ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}

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
          <Text style={styles.ctaText}>{i18n.t('ps', 'common.continue')}</Text>
        </Animated.View>
      </Pressable>
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
  back: { alignSelf: 'flex-start', padding: 8 },
  title: { fontSize: 22, fontWeight: '700', color: motion.color.text, marginTop: 24 },
  subtitle: { color: '#888', marginTop: 4, marginBottom: 32 },
  boxes: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  box: {
    width: 44,
    height: 56,
    borderRadius: motion.radius.md,
    backgroundColor: motion.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0d8cc',
  },
  boxFilled: { borderColor: motion.color.primary },
  boxText: { fontSize: 24, fontWeight: '700', color: motion.color.text },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
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
});

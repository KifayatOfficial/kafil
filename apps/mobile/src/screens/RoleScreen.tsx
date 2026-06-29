// Pick role(s). §3 — a user can hold multiple roles. Default first-time user is asked
// to pick "I want to work" / "I want to hire" / "Both" — the picker creates the matching
// role rows + role-profile rows lazily.

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';

type Choice = 'worker' | 'employer' | 'both';

interface Props {
  onDone: (choice: Choice) => void;
}

export function RoleScreen({ onDone }: Props) {
  const { api, lang } = useAuth();
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (choice: Choice) => {
    if (busy) return;
    setBusy(choice);
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const roles = choice === 'both' ? ['worker', 'employer'] : [choice];
    try {
      for (const role of roles) {
        const r = await api.post('/api/auth/me/roles', { role }, { idempotencyKey: randomUUID() });
        // 201 = added, 200 with `added:false` = already had it (also fine).
        const ok = (r.data as { ok: boolean }).ok;
        if (!ok && r.status !== 201) {
          const data = r.data as { message?: string };
          throw new Error(data.message ?? `role add failed (${r.status})`);
        }
      }
      void haptic(motion.hapticToken.SUCCESS);
      onDone(choice);
    } catch (e: unknown) {
      void haptic(motion.hapticToken.ERROR);
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{i18n.t(lang, 'onboarding.role_prompt')}</Text>
      <Text style={styles.subtitle}>{i18n.t(lang, 'onboarding.role_subtitle')}</Text>

      <Option label={i18n.t(lang, 'onboarding.role_worker')} sub="مزدور / کارګر" choice="worker" busy={busy === 'worker'} onPress={submit} />
      <Option label={i18n.t(lang, 'onboarding.role_employer')} sub="کارفرما" choice="employer" busy={busy === 'employer'} onPress={submit} />
      <Option label={i18n.t(lang, 'common.continue')} sub="دواړه" choice="both" busy={busy === 'both'} onPress={submit} />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Option({
  label,
  sub,
  choice,
  busy,
  onPress,
}: {
  label: string;
  sub: string;
  choice: Choice;
  busy: boolean;
  onPress: (c: Choice) => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={() => onPress(choice)}
      onPressIn={() => {
        onPressIn();
        void haptic(motion.hapticToken.TAP_LIGHT);
      }}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.option, animated]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.optionLabel}>{label}</Text>
          <Text style={styles.optionSub}>{sub}</Text>
        </View>
        {busy ? <ActivityIndicator color={motion.color.primary} /> : <Text style={styles.arrow}>›</Text>}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, padding: 24, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: '700', color: motion.color.text, marginBottom: 6 },
  subtitle: { color: '#888', marginBottom: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: motion.color.surface,
    padding: 18,
    borderRadius: motion.radius.md,
    marginBottom: 12,
  },
  optionLabel: { fontSize: 17, fontWeight: '600', color: motion.color.text },
  optionSub: { color: '#888', marginTop: 4 },
  arrow: { fontSize: 24, color: motion.color.primary, marginStart: 12 },
  error: { color: motion.color.danger, marginTop: 16, textAlign: 'center' },
});

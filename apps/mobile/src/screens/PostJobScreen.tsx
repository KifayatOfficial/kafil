// Post a job (employer side). Minimum-viable form: title, optional description,
// rate, rate-unit, headcount, duration, specialty(ies), location.
//
// Design choices for low-literacy and 2G/3G context:
//   - Specialty picker is icons-first (re-uses the WorkerSpecialtiesScreen pattern).
//   - Rate is a number input with helper text in PKR; no unit ambiguity.
//   - Location currently uses the seeded demo location; full landmark/pin-drop UI
//     comes when we wire @kafil/core's Location flow (§2.2).
//   - Class-A press on every interactive element; class-D reward on success.
//   - §10/F1 safety reminder is NOT shown here (it's a worker-side concern); we instead
//     show "Your job will go live after you confirm" so the employer knows expectations.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface SpecialtyRow {
  id: string;
  slug: string;
  name_ps?: string | null;
  name_ur?: string | null;
  name_en?: string | null;
  icon?: string | null;
}

interface Location {
  id: string;
  label: string;
  district: string | null;
}

// Until we wire a real location picker (§2.2 / §25), employers default to their own
// recorded base location. For demo seeding we use the well-known seeded id.
const DEMO_LOCATION_ID = '00000000-0000-0000-0000-000000000001';

type Phase = 'editing' | 'posting' | 'posted' | 'error';

interface Props {
  onClose: () => void;
  onPosted: (jobId: string) => void;
}

const FALLBACK_ICON: Record<string, string> = {
  masonry: '🧱',
  electrician: '💡',
  carpenter: '🔨',
  plumber: '🚰',
  welder: '⚡',
};

export function PostJobScreen({ onClose, onPosted }: Props) {
  const { api } = useAuth();
  const [phase, setPhase] = useState<Phase>('editing');
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [durationDays, setDurationDays] = useState('');
  const [specialties, setSpecialties] = useState<SpecialtyRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; specialties: SpecialtyRow[] }>('/api/specialties');
      if (r.success) setSpecialties((r.data as { specialties: SpecialtyRow[] }).specialties);
    })().catch(() => undefined);
  }, [api]);

  const togglePick = (id: string) => {
    void haptic(motion.hapticToken.TAP_LIGHT);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rateNum = Number.parseInt(rate, 10);
  const headcountNum = Number.parseInt(headcount, 10);
  const durationNum = durationDays ? Number.parseInt(durationDays, 10) : null;
  const canSubmit =
    title.trim().length >= 3 &&
    Number.isFinite(rateNum) &&
    rateNum > 0 &&
    Number.isFinite(headcountNum) &&
    headcountNum > 0 &&
    picked.size > 0 &&
    phase !== 'posting';

  const submit = async () => {
    if (!canSubmit) return;
    setPhase('posting');
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const idempotencyKey = randomUUID();
    const body: Record<string, unknown> = {
      title: title.trim(),
      location_id: DEMO_LOCATION_ID,
      headcount: headcountNum,
      rate_pkr: rateNum,
      rate_unit: 'day',
      specialty_ids: Array.from(picked),
      idempotency_key: idempotencyKey,
      payment_mode: 'cash',
    };
    if (description.trim()) body.description = description.trim();
    if (durationNum !== null && durationNum > 0) body.duration_days = durationNum;

    const r = await api.post<{ ok: true; value: { jobId: string } }>(
      '/api/jobs',
      body,
      { idempotencyKey },
    );
    if (r.success) {
      const jobId = (r.data as { value: { jobId: string } }).value.jobId;
      void haptic(motion.hapticToken.SUCCESS);
      setPhase('posted');
      setTimeout(() => onPosted(jobId), 1500);
    } else {
      void haptic(motion.hapticToken.ERROR);
      setError((r.data as { message?: string }).message ?? `post failed (${r.status})`);
      setPhase('error');
    }
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const ctaAnimated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (phase === 'posted') {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.D_REWARD} style={{ width: 180, height: 180 }} loop />
        <Text style={styles.successTitle}>Job posted!</Text>
        <Text style={styles.muted}>Workers in your area can apply now.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={styles.root}>
        <Pressable onPress={onClose} hitSlop={16} style={styles.back}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← Cancel</Text>
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.title}>Post a job</Text>
          <Text style={styles.muted}>Describe what you need. Be specific.</Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            placeholder="e.g. Brickwork for house renovation"
            maxLength={200}
          />

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.multi]}
            placeholder="Quality matters. 2-week project starting Monday."
            multiline
            numberOfLines={4}
            maxLength={4000}
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Rate per day (PKR)</Text>
              <TextInput
                value={rate}
                onChangeText={setRate}
                style={styles.input}
                placeholder="3500"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>How many workers</Text>
              <TextInput
                value={headcount}
                onChangeText={setHeadcount}
                style={styles.input}
                placeholder="1"
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>

          <Text style={styles.label}>Duration in days (optional)</Text>
          <TextInput
            value={durationDays}
            onChangeText={setDurationDays}
            style={styles.input}
            placeholder="3"
            keyboardType="number-pad"
            maxLength={3}
          />

          <Text style={styles.label}>What kind of work?</Text>
          <Text style={styles.muted}>Tap all that apply.</Text>

          {!specialties ? (
            <ActivityIndicator style={{ marginTop: 8 }} />
          ) : (
            <View style={styles.grid}>
              {specialties.map((sp) => {
                const isPicked = picked.has(sp.id);
                const label = sp.name_ps ?? sp.name_en ?? sp.slug;
                const icon = (sp.icon && FALLBACK_ICON[sp.slug]) ?? FALLBACK_ICON[sp.slug] ?? '•';
                return (
                  <Pressable key={sp.id} onPress={() => togglePick(sp.id)} style={{ width: '33%' }}>
                    <View style={[styles.tile, isPicked && styles.tilePicked]}>
                      <Text style={{ fontSize: 32, marginBottom: 4 }}>{icon}</Text>
                      <Text style={[styles.tileLabel, isPicked && styles.tileLabelPicked]}>
                        {label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

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
            <Animated.View style={[styles.cta, !canSubmit && styles.ctaDisabled, ctaAnimated]}>
              {phase === 'posting' ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.ctaText}>Post job</Text>
              )}
            </Animated.View>
          </Pressable>

          <Text style={[styles.muted, { textAlign: 'center', marginTop: 12 }]}>
            Your job will go live immediately.
          </Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingHorizontal: 20, paddingTop: 50 },
  back: { padding: 8, alignSelf: 'flex-start' },
  title: { fontSize: 26, fontWeight: '700', color: motion.color.text, marginTop: 12 },
  label: { color: motion.color.text, marginTop: 18, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: motion.color.text,
  },
  multi: { textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  tile: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    margin: 3,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tilePicked: { borderColor: motion.color.primary, backgroundColor: '#e8f1ec' },
  tileLabel: { fontSize: 12, fontWeight: '600', color: motion.color.text, textAlign: 'center' },
  tileLabelPicked: { color: motion.color.primary },
  cta: {
    backgroundColor: motion.color.primary,
    paddingVertical: 14,
    borderRadius: motion.radius.pill,
    marginTop: 24,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#bbb' },
  ctaText: { color: 'white', fontWeight: '700', fontSize: 18 },
  successTitle: { fontSize: 28, fontWeight: '700', color: motion.color.primary, marginTop: 10 },
  muted: { color: '#888', fontSize: 13 },
  error: { color: motion.color.danger, marginTop: 12, textAlign: 'center' },
});

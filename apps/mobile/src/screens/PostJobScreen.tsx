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
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
import { makeStyles, useTheme } from '../theme';
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

interface RateInsight {
  hasData: boolean;
  sampleSize: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
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
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>('editing');
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [durationDays, setDurationDays] = useState('');
  const [specialties, setSpecialties] = useState<SpecialtyRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [insight, setInsight] = useState<RateInsight | null>(null);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; specialties: SpecialtyRow[] }>('/api/specialties');
      if (r.success) setSpecialties((r.data as { specialties: SpecialtyRow[] }).specialties);
    })().catch(() => undefined);
  }, [api]);

  // §26/M27 — fetch the market rate band when exactly ONE specialty is picked (a mixed
  // pick has no single market). Clears otherwise so we never show a stale band.
  useEffect(() => {
    if (picked.size !== 1) {
      setInsight(null);
      return;
    }
    const [only] = Array.from(picked);
    let cancelled = false;
    (async () => {
      const r = await api.get<{ ok: true; insight: RateInsight }>(`/api/specialties/${only}/rate-insight`);
      if (!cancelled && r.success) setInsight((r.data as { insight: RateInsight }).insight);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, picked]);

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
  // §26/M27 — below-market only fires once the employer typed a positive rate AND we
  // have a real band; informational, never blocks the post.
  const belowMarket =
    insight?.hasData === true &&
    insight.p25 != null &&
    Number.isFinite(rateNum) &&
    rateNum > 0 &&
    rateNum < insight.p25;
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
        <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.D_REWARD} style={{ width: 180, height: 180 }} loop={false} />
        <Text style={styles.successTitle}>{i18n.t(lang, 'job.posted')}</Text>
        <Text style={styles.muted}>{i18n.t(lang, 'job.live_immediately')}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={styles.root}>
        <Pressable onPress={onClose} hitSlop={16} style={styles.back} accessibilityLabel={i18n.t(lang, 'common.cancel')}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.cancel')}</Text>
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.title}>{i18n.t(lang, 'job.post_title')}</Text>
          <Text style={styles.muted}>{i18n.t(lang, 'job.post_subtitle')}</Text>

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
                style={[styles.input, belowMarket && styles.inputWarn]}
                placeholder={insight?.median ? String(insight.median) : '3500'}
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

          {/* §26/M27 — market band + soft below-market warning. KAFIL informs, never enforces. */}
          {insight?.hasData && insight.p25 != null && insight.p75 != null ? (
            <Text style={styles.rateMarket}>
              {i18n.t(lang, 'rate.market')}: {insight.p25}–{insight.p75} PKR
            </Text>
          ) : null}
          {belowMarket ? (
            <Text style={styles.rateWarn}>⚠ {i18n.t(lang, 'rate.below_market')}</Text>
          ) : null}

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
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.ctaText}>Post job</Text>
              )}
            </Animated.View>
          </Pressable>

          <Text style={[styles.muted, { textAlign: 'center', marginTop: 12 }]}>
            {i18n.t(lang, 'job.live_immediately')}
          </Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingHorizontal: 20, paddingTop: 50 },
  back: { padding: t.spacing.sm, alignSelf: 'flex-start' },
  title: { ...t.type.h1, color: t.colors.text, marginTop: t.spacing.md },
  label: { ...t.type.label, color: t.colors.text, marginTop: 18, marginBottom: t.spacing.sm - 2 },
  input: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 14,
    paddingVertical: t.spacing.md,
    fontSize: 15,
    color: t.colors.text,
  },
  multi: { textAlignVertical: 'top' },
  inputWarn: { borderColor: t.colors.warning },
  rateMarket: { ...t.type.caption, color: t.colors.textMuted, marginTop: t.spacing.sm },
  rateWarn: { ...t.type.caption, color: t.colors.warning, marginTop: t.spacing.xs },
  row: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: t.spacing.sm },
  tile: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    margin: 3,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  tilePicked: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
  tileLabel: { ...t.type.micro, fontSize: 12, color: t.colors.text, textAlign: 'center' },
  tileLabelPicked: { color: t.colors.primary },
  cta: {
    backgroundColor: t.colors.primary,
    paddingVertical: 14,
    borderRadius: t.radius.pill,
    marginTop: t.spacing.xl,
    alignItems: 'center',
    ...t.elevation(1),
  },
  ctaDisabled: { backgroundColor: t.colors.skeleton, ...t.elevation(0) },
  ctaText: { ...t.type.label, color: t.colors.textOnPrimary, fontSize: 18 },
  successTitle: { ...t.type.display, color: t.colors.primary, marginTop: 10 },
  muted: { ...t.type.caption, color: t.colors.textMuted },
  error: { ...t.type.body, color: t.colors.danger, marginTop: t.spacing.md, textAlign: 'center' },
}));

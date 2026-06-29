// Job detail + apply. Tapped from a JobCard.
// §27.3 class-A press on every interactive element.
// §27.3 class-D mascot reward on apply success.
// §26/M12 — on 409 from the server (job filled / stale), surface a soft inline state
//   instead of a generic error: "This job just filled — here are 3 similar ones"
//   (the "similar" list is added in a later round; for now we show the friendly state).
// §10/F1 — workers never pay to apply: the UI never asks for money on this screen.

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
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
import { SkeletonList } from '../components/Skeleton';
import { ReportSheet } from '../components/ReportSheet';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface Job {
  id: string;
  title: string;
  description: string | null;
  ratePkr: number;
  rateUnit: string;
  durationDays: number | null;
  headcount: number;
  status: string;
  paymentMode: string;
}

interface Props {
  jobId: string;
  onClose: () => void;
  /** Called when the user successfully applies — caller usually pops back to home. */
  onApplied: () => void;
}

type Phase = 'loading' | 'ready' | 'applying' | 'applied' | 'stale' | 'error';

export function JobDetailScreen({ jobId, onClose, onApplied }: Props) {
  const { api, lang } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [proposedRate, setProposedRate] = useState('');
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; job: Job }>(`/api/jobs/${jobId}`);
      if (r.success) {
        setJob((r.data as { job: Job }).job);
        setPhase('ready');
      } else {
        setError((r.data as { message?: string }).message ?? 'failed to load');
        setPhase('error');
      }
    })().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'network error');
      setPhase('error');
    });
  }, [api, jobId]);

  const apply = async () => {
    if (!job || phase === 'applying' || phase === 'applied') return;
    setPhase('applying');
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const idempotencyKey = randomUUID();
    const body: Record<string, unknown> = { idempotency_key: idempotencyKey };
    if (message.trim()) body.message = message.trim();
    const proposed = Number.parseInt(proposedRate, 10);
    if (Number.isFinite(proposed) && proposed > 0) body.proposed_rate_pkr = proposed;

    const r = await api.post(`/api/jobs/${jobId}/applications`, body, {
      idempotencyKey,
    });

    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setPhase('applied');
      // Small delay so the user sees the class-D reward.
      setTimeout(onApplied, 1500);
      return;
    }

    // §26/M12 — 409 conflict on apply: typically "job already filled" or
    // "you have an active application on this job". Either way, soft-state.
    if (r.status === 409) {
      void haptic(motion.hapticToken.WARNING);
      setPhase('stale');
      return;
    }

    void haptic(motion.hapticToken.ERROR);
    setError((r.data as { message?: string }).message ?? `apply failed (${r.status})`);
    setPhase('error');
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const ctaAnimated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={styles.root}>
        <Pressable onPress={onClose} hitSlop={16} style={styles.back} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>

        {phase === 'loading' ? (
          <View style={{ marginTop: 40 }}><SkeletonList rows={3} /></View>
        ) : phase === 'applied' ? (
          <SuccessView job={job!} lang={lang} />
        ) : phase === 'stale' ? (
          <StaleView jobTitle={job?.title ?? ''} onBack={onClose} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={styles.title}>{job?.title}</Text>
            <View style={styles.metaRow}>
              <MetaPill label={`${job?.ratePkr} PKR / ${job?.rateUnit}`} />
              {job?.durationDays != null ? <MetaPill label={`${job.durationDays} days`} /> : null}
              <MetaPill label={`${job?.headcount} needed`} />
              <MetaPill label={job?.paymentMode ?? ''} />
            </View>

            {job?.description ? (
              <Text style={styles.description}>{job.description}</Text>
            ) : null}

            <Text style={styles.label}>Your message (optional)</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              style={styles.input}
              placeholder="Tell the employer why you're a fit"
              multiline
              numberOfLines={3}
              maxLength={1000}
            />

            <Text style={styles.label}>Your proposed rate, PKR (optional)</Text>
            <TextInput
              value={proposedRate}
              onChangeText={setProposedRate}
              style={styles.input}
              placeholder={`Default: ${job?.ratePkr}`}
              keyboardType="number-pad"
              maxLength={6}
            />

            {/* §10/F1 — explicit reassurance, surfaced once not buried in T&Cs */}
            <Text style={styles.safetyNote}>
              KAFIL never asks workers to pay to apply. If anyone requests a fee,{' '}
              <Text style={styles.reportLink} onPress={() => setReportOpen(true)}>
                {i18n.t(lang, 'safety.report_job')}
              </Text>
              .
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={apply}
              onPressIn={() => {
                onPressIn();
                void haptic(motion.hapticToken.TAP_LIGHT);
              }}
              onPressOut={onPressOut}
              disabled={phase === 'applying' || job?.status !== 'open'}
            >
              <Animated.View
                style={[
                  styles.cta,
                  (phase === 'applying' || job?.status !== 'open') && styles.ctaDisabled,
                  ctaAnimated,
                ]}
              >
                {phase === 'applying' ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.ctaText}>{i18n.t(lang, 'job.apply')}</Text>
                )}
              </Animated.View>
            </Pressable>

            {job?.status !== 'open' ? (
              <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>
                This job is not accepting applications right now.
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="job"
        targetId={jobId}
      />
    </KeyboardAvoidingView>
  );
}

function MetaPill({ label }: { label: string }) {
  if (!label) return null;
  return (
    <View style={styles.metaPill}>
      <Text style={styles.metaPillText}>{label}</Text>
    </View>
  );
}

function SuccessView({ job, lang }: { job: Job; lang: import('@kafil/core').Lang }) {
  // §27 class-D reward — plays ONCE (loop:false), not the looping idle mascot.
  return (
    <View style={styles.successWrap}>
      <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.D_REWARD} style={{ width: 180, height: 180 }} loop={false} />
      <Text style={styles.successTitle}>{i18n.t(lang, 'job.applied')}</Text>
      <Text style={styles.muted}>"{job.title}"</Text>
    </View>
  );
}

function StaleView({ jobTitle, onBack }: { jobTitle: string; onBack: () => void }) {
  return (
    <View style={styles.staleWrap}>
      <Text style={styles.staleEmoji}>⌛</Text>
      <Text style={styles.staleTitle}>This job just filled</Text>
      <Text style={styles.muted}>
        "{jobTitle}" was taken by another worker — or you've already applied. Try a similar one nearby.
      </Text>
      <Pressable onPress={onBack} style={styles.staleCta}>
        <Text style={styles.ctaText}>Back to jobs</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingHorizontal: 20, paddingTop: 50 },
  back: { padding: 8, alignSelf: 'flex-start' },
  title: { fontSize: 26, fontWeight: '700', color: motion.color.text, marginTop: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metaPill: {
    backgroundColor: motion.color.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: motion.radius.pill,
  },
  metaPillText: { color: motion.color.text, fontSize: 13 },
  description: { color: motion.color.text, fontSize: 15, lineHeight: 22, marginTop: 18 },
  label: { color: motion.color.text, marginTop: 22, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: motion.color.text,
  },
  safetyNote: {
    color: motion.color.warning,
    fontSize: 12,
    marginTop: 16,
    fontStyle: 'italic',
  },
  reportLink: {
    color: motion.color.danger,
    fontWeight: '700',
    textDecorationLine: 'underline',
    fontStyle: 'normal',
  },
  error: { color: motion.color.danger, marginTop: 12, textAlign: 'center' },
  cta: {
    backgroundColor: motion.color.primary,
    paddingVertical: 14,
    borderRadius: motion.radius.pill,
    marginTop: 24,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#bbb' },
  ctaText: { color: 'white', fontWeight: '700', fontSize: 18 },
  muted: { color: '#888', fontSize: 14, textAlign: 'center', marginTop: 8 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  successTitle: { fontSize: 28, fontWeight: '700', color: motion.color.primary, marginTop: 10 },
  staleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  staleEmoji: { fontSize: 64, marginBottom: 12 },
  staleTitle: { fontSize: 22, fontWeight: '700', color: motion.color.text, marginBottom: 8 },
  staleCta: {
    backgroundColor: motion.color.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: motion.radius.pill,
    marginTop: 16,
  },
});

// Employer's view of applicants for one of their jobs. Tapping "Accept" on a row
// fills the next open slot (optimistic-locked) and creates the assignment (§4.3).
//
// Slot handling: the API returns the slot list; on accept we use the FIRST open slot
// with its current version. If the version is stale (someone else accepted in parallel,
// or the slot was filled between view and accept), the server returns 409 and we soft-
// reload (§24/A4 / §26/M12-style UX).

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { SkeletonList } from '../components/Skeleton';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';

interface Applicant {
  id: string;
  workerId: string;
  status: string;
  message: string | null;
  proposedRatePkr: number | null;
  createdAt: string;
  worker: {
    id: string;
    displayName: string;
    photoUrl: string | null;
    kycLevel: number;
    workerProfile: {
      ratingBayesian: string | number | null;
      jobsCompleted: number;
      bio: string | null;
    } | null;
  };
}

interface JobSlot {
  id: string;
  jobId: string;
  slotIndex: number;
  status: string;
  assignedWorkerId: string | null;
  version: number;
}

interface JobDetail {
  id: string;
  title: string;
  status: string;
  headcount: number;
  slots: JobSlot[];
}

interface Props {
  jobId: string;
  onBack: () => void;
}

export function MyJobApplicantsScreen({ jobId, onBack }: Props) {
  const { api, lang } = useAuth();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [applicants, setApplicants] = useState<Applicant[] | null>(null);
  const [acceptingAppId, setAcceptingAppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [jobR, appsR] = await Promise.all([
      api.get<{ ok: true; job: JobDetail }>(`/api/jobs/${jobId}`),
      api.get<{ ok: true; applications: Applicant[] }>(
        `/api/jobs/${jobId}/applications-for-employer`,
      ),
    ]);
    if (jobR.success) setJob((jobR.data as { job: JobDetail }).job);
    if (appsR.success) setApplicants((appsR.data as { applications: Applicant[] }).applications);
  }, [api, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (appId: string) => {
    if (!job || acceptingAppId) return;
    const openSlot = job.slots.find((s) => s.status === 'open');
    if (!openSlot) {
      setError('All slots are filled.');
      return;
    }
    setAcceptingAppId(appId);
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const key = randomUUID();
    const r = await api.post(
      `/api/applications/${appId}/accept`,
      {
        slot_id: openSlot.id,
        expected_slot_version: openSlot.version,
        idempotency_key: key,
      },
      { idempotencyKey: key },
    );

    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      // refresh both lists
      await load();
    } else if (r.status === 409) {
      void haptic(motion.hapticToken.WARNING);
      setError('Slot version changed (someone else acted). Refreshing…');
      await load();
    } else {
      void haptic(motion.hapticToken.ERROR);
      setError((r.data as { message?: string }).message ?? `accept failed (${r.status})`);
    }
    setAcceptingAppId(null);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>
        <Text style={styles.h1} numberOfLines={1}>
          {job?.title ?? '…'}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {job ? (
        <View style={styles.jobSummary}>
          <Text style={styles.muted}>
            {job.headcount} needed · {job.slots.filter((s) => s.status === 'open').length} open ·{' '}
            {job.slots.filter((s) => s.status === 'filled').length} filled · status {job.status}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={{ color: motion.color.warning }}>{error}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {!applicants ? (
          <SkeletonList rows={3} />
        ) : applicants.length === 0 ? (
          <Text style={styles.muted}>{i18n.t(lang, 'applicants.empty')}</Text>
        ) : (
          applicants.map((a) => (
            <ApplicantCard
              key={a.id}
              app={a}
              accepting={acceptingAppId === a.id}
              canAccept={(job?.slots.some((s) => s.status === 'open') ?? false) && a.status === 'pending'}
              onAccept={() => accept(a.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ApplicantCard({
  app,
  accepting,
  canAccept,
  onAccept,
}: {
  app: Applicant;
  accepting: boolean;
  canAccept: boolean;
  onAccept: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const wp = app.worker.workerProfile;
  const rating = wp?.ratingBayesian ? Number(wp.ratingBayesian) : null;
  return (
    <View style={styles.card}>
      <Text style={styles.workerName}>{app.worker.displayName}</Text>
      <Text style={styles.muted}>
        {wp?.jobsCompleted ?? 0} job{wp?.jobsCompleted === 1 ? '' : 's'} completed
        {rating != null && rating > 0 ? ` · ⭐ ${rating.toFixed(1)}` : ''}
        {' · KYC L'}{app.worker.kycLevel}
      </Text>
      {app.message ? <Text style={styles.message}>"{app.message}"</Text> : null}
      {app.proposedRatePkr != null ? (
        <Text style={styles.muted}>Proposed rate: {app.proposedRatePkr} PKR/day</Text>
      ) : null}
      <Text style={[styles.muted, { marginTop: 4 }]}>Status: {app.status}</Text>

      <Pressable
        onPress={onAccept}
        onPressIn={() => {
          onPressIn();
          void haptic(motion.hapticToken.TAP_LIGHT);
        }}
        onPressOut={onPressOut}
        disabled={!canAccept || accepting}
      >
        <Animated.View
          style={[
            styles.acceptBtn,
            (!canAccept || accepting) && styles.acceptBtnDisabled,
            animated,
          ]}
        >
          {accepting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.acceptBtnText}>
              {app.status === 'accepted' ? 'Accepted' : canAccept ? 'Accept' : 'No open slot'}
            </Text>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  h1: { fontSize: 18, fontWeight: '700', color: motion.color.text, flex: 1, textAlign: 'center' },
  jobSummary: { paddingHorizontal: 16, paddingBottom: 8 },
  muted: { color: '#888', fontSize: 13 },
  errorBanner: {
    backgroundColor: '#fcefd9',
    padding: 10,
    marginHorizontal: 16,
    borderRadius: motion.radius.md,
    borderWidth: 1,
    borderColor: motion.color.warning,
  },
  card: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: 16,
    marginBottom: 10,
  },
  workerName: { fontSize: 16, fontWeight: '600', color: motion.color.text },
  message: { color: motion.color.text, marginTop: 8, fontStyle: 'italic' },
  acceptBtn: {
    backgroundColor: motion.color.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: motion.radius.pill,
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  acceptBtnDisabled: { backgroundColor: '#bbb' },
  acceptBtnText: { color: 'white', fontWeight: '700' },
});

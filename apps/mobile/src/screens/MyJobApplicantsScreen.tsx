// Employer's view of applicants for one of their jobs. Tapping "Accept" on a row
// fills the next open slot (optimistic-locked) and creates the assignment (§4.3).
//
// Slot handling: the API returns the slot list; on accept we use the FIRST open slot
// with its current version. If the version is stale (someone else accepted in parallel,
// or the slot was filled between view and accept), the server returns 409 and we soft-
// reload (§24/A4 / §26/M12-style UX).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { SkeletonList } from '../components/Skeleton';
import { useAuth } from '../auth/AuthContext';
import { useOutbox, findOp } from '../outbox/OutboxContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { makeStyles, useTheme } from '../theme';

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
  featuredUntil?: string | null;
}

interface Props {
  jobId: string;
  onBack: () => void;
}

export function MyJobApplicantsScreen({ jobId, onBack }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const { enqueue, ops, online, prune } = useOutbox();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [applicants, setApplicants] = useState<Applicant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boosting, setBoosting] = useState(false);
  // Op ids whose terminal outcome we've already reconciled — so the effect reloads
  // (and haptic-fires) once per resolution, not on every ops snapshot.
  const reconciled = useRef<Set<string>>(new Set());

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

  // §6.1 — boost this job to the top of the feed (paid). Charged from the employer's
  // wallet; the server enforces ownership, open-status, balance, and no double-charge.
  const isFeatured = !!job?.featuredUntil && new Date(job.featuredUntil).getTime() > Date.now();
  const boost = async () => {
    if (!job || boosting || isFeatured || job.status !== 'open') return;
    setBoosting(true);
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(`/api/jobs/${jobId}/feature`, {}, { idempotencyKey: randomUUID() });
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      await load(); // reflect featuredUntil
    } else {
      void haptic(motion.hapticToken.ERROR);
      // The service returns CONFLICT for insufficient balance; show the friendly hint.
      setError(
        r.status === 409
          ? i18n.t(lang, 'featured.insufficient')
          : (r.data as { message?: string }).message ?? `boost failed (${r.status})`,
      );
    }
    setBoosting(false);
  };

  useEffect(() => {
    void load();
  }, [load]);

  // Reconcile server-authoritative outcomes of queued accepts (§13/§14). A queued
  // accept carries the slot's expected version, so a lost race resolves to a clean
  // 409→conflict here — never a silent over-hire past headcount.
  useEffect(() => {
    const mine = ops.filter(
      (o) => o.kind === 'accept' && (o.meta?.jobId as string | undefined) === jobId,
    );
    for (const op of mine) {
      const terminal = op.status === 'done' || op.status === 'conflict' || op.status === 'failed';
      if (!terminal || reconciled.current.has(op.id)) continue;
      reconciled.current.add(op.id);
      if (op.status === 'done') {
        void haptic(motion.hapticToken.SUCCESS);
        void load();
      } else if (op.status === 'conflict') {
        void haptic(motion.hapticToken.WARNING);
        setError('Slot was taken by another action. Refreshing…');
        void load();
      } else {
        void haptic(motion.hapticToken.ERROR);
        setError(op.outcome?.message ?? `accept failed (${op.outcome?.status ?? 0})`);
      }
      // Terminal outcome consumed (UI reloaded / error shown) — drop it so the
      // queue doesn't grow unbounded across many accepts.
      void prune([op.id]);
    }
  }, [ops, jobId, load, prune]);

  /** A live (pending/sending) queued accept for this applicant, if any. */
  const pendingAcceptFor = (appId: string) =>
    findOp(
      ops,
      'accept',
      (m) => (m?.appId as string | undefined) === appId,
    );

  const accept = async (appId: string) => {
    if (!job) return;
    // Guard double-tap: an in-flight accept for this applicant already exists.
    const existing = pendingAcceptFor(appId);
    if (existing && (existing.status === 'pending' || existing.status === 'sending')) return;
    const openSlot = job.slots.find((s) => s.status === 'open');
    if (!openSlot) {
      setError('All slots are filled.');
      return;
    }
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const key = randomUUID();
    // §13 — optimistic enqueue. expected_slot_version travels with the op, so the
    // optimistic lock still arbitrates even when the accept was queued offline.
    await enqueue({
      method: 'POST',
      path: `/api/applications/${appId}/accept`,
      body: {
        slot_id: openSlot.id,
        expected_slot_version: openSlot.version,
        idempotency_key: key,
      },
      kind: 'accept',
      id: key,
      meta: { appId, jobId },
    });
    if (!online) setError(i18n.t(lang, 'offline.banner'));
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
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

          {/* §6.1 — boost to top of feed. Show the badge when active, the paid CTA when
              the job is open and not yet featured. */}
          {isFeatured ? (
            <View style={styles.featuredActive}>
              <Text style={styles.featuredActiveText}>{i18n.t(lang, 'featured.active')}</Text>
            </View>
          ) : job.status === 'open' ? (
            <Pressable
              onPress={boost}
              disabled={boosting}
              style={[styles.boostBtn, boosting && styles.boostBtnDisabled]}
              accessibilityLabel={i18n.t(lang, 'featured.boost')}
            >
              {boosting ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.boostBtnText}>⭐ {i18n.t(lang, 'featured.boost')} · 150 PKR</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={{ color: colors.warning }}>{error}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {!applicants ? (
          <SkeletonList rows={3} />
        ) : applicants.length === 0 ? (
          <Text style={styles.muted}>{i18n.t(lang, 'applicants.empty')}</Text>
        ) : (
          applicants.map((a) => {
            const op = pendingAcceptFor(a.id);
            const inFlight = op?.status === 'pending' || op?.status === 'sending';
            return (
              <ApplicantCard
                key={a.id}
                app={a}
                lang={lang}
                accepting={inFlight ?? false}
                queuedOffline={inFlight === true && !online}
                canAccept={(job?.slots.some((s) => s.status === 'open') ?? false) && a.status === 'pending'}
                onAccept={() => accept(a.id)}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function ApplicantCard({
  app,
  lang,
  accepting,
  queuedOffline,
  canAccept,
  onAccept,
}: {
  app: Applicant;
  lang: import('@kafil/core').Lang;
  accepting: boolean;
  queuedOffline: boolean;
  canAccept: boolean;
  onAccept: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
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
          {queuedOffline ? (
            <Text style={styles.acceptBtnText}>{i18n.t(lang, 'offline.queued')}</Text>
          ) : accepting ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.acceptBtnText}>
              {app.status === 'accepted'
                ? i18n.t(lang, 'applicants.accepted')
                : canAccept
                  ? i18n.t(lang, 'applicants.accept')
                  : i18n.t(lang, 'applicants.no_slot')}
            </Text>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  },
  h1: { ...t.type.title, color: t.colors.text, flex: 1, textAlign: 'center' },
  jobSummary: { paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  muted: { ...t.type.caption, color: t.colors.textMuted },
  boostBtn: {
    marginTop: t.spacing.sm,
    backgroundColor: t.colors.primary,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.pill,
    alignSelf: 'flex-start',
  },
  boostBtnDisabled: { backgroundColor: t.colors.skeleton },
  boostBtnText: { ...t.type.label, color: t.colors.textOnPrimary, fontWeight: '700' },
  featuredActive: {
    marginTop: t.spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: t.colors.primarySoft,
    borderColor: t.colors.primary,
    borderWidth: 1,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.pill,
  },
  featuredActiveText: { ...t.type.caption, color: t.colors.primary, fontWeight: '700' },
  errorBanner: {
    backgroundColor: t.colors.warningSoft,
    padding: t.spacing.sm,
    marginHorizontal: t.spacing.lg,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.warning,
  },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  workerName: { ...t.type.title, color: t.colors.text },
  message: { ...t.type.body, color: t.colors.text, marginTop: t.spacing.sm, fontStyle: 'italic' },
  acceptBtn: {
    backgroundColor: t.colors.primary,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: 18,
    borderRadius: t.radius.pill,
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  acceptBtnDisabled: { backgroundColor: t.colors.skeleton },
  acceptBtnText: { ...t.type.label, color: t.colors.textOnPrimary, fontWeight: '700' },
}));

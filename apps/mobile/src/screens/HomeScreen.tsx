// Authenticated home — job feed. Tapping a card opens JobDetailScreen.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
import { JobDetailScreen } from './JobDetailScreen';
import { PostJobScreen } from './PostJobScreen';
import { MyActivityScreen } from './MyActivityScreen';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface Job {
  id: string;
  title: string;
  ratePkr: number;
  rateUnit: string;
  status: string;
}

type Modal = 'detail' | 'post' | 'activity';

export function HomeScreen() {
  const { api, signOut, inCooldown } = useAuth();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; jobs: Job[] }>('/api/jobs');
    if (r.success) setJobs((r.data as { jobs: Job[] }).jobs);
    else setError('Failed to load');
  }, [api]);

  useEffect(() => {
    (async () => {
      const me = await api.get<{ ok: true; user: { roles: Array<{ role: string }> } }>('/api/auth/me');
      const list = ((me.data as { user?: { roles?: Array<{ role: string }> } }).user?.roles ?? [])
        .map((r) => r.role);
      setRoles(list);
    })().catch(() => undefined);
  }, [api]);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed'));
  }, [load, reloadKey]);

  if (openJobId) {
    return (
      <JobDetailScreen
        jobId={openJobId}
        onClose={() => setOpenJobId(null)}
        onApplied={() => {
          setOpenJobId(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  if (modal === 'post') {
    return (
      <PostJobScreen
        onClose={() => setModal(null)}
        onPosted={() => {
          setModal(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  if (modal === 'activity') {
    return <MyActivityScreen onBack={() => setModal(null)} />;
  }

  const isEmployer = roles.includes('employer');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.E_MASCOT} style={styles.mascot} loop />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.h1}>{i18n.t('ps', 'app.name')}</Text>
          <Text style={styles.muted}>Home</Text>
        </View>
        <Pressable onPress={() => void signOut()} hitSlop={10}>
          <Text style={{ color: motion.color.primary }}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={() => setModal('activity')} style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>My activity</Text>
        </Pressable>
        {isEmployer ? (
          <Pressable onPress={() => setModal('post')} style={[styles.actionBtn, styles.actionBtnPrimary]}>
            <Text style={[styles.actionBtnText, { color: 'white' }]}>+ Post a job</Text>
          </Pressable>
        ) : null}
      </View>

      {inCooldown ? (
        <View style={styles.cooldownBanner}>
          <Text style={styles.cooldownTitle}>New device — security cooldown</Text>
          <Text style={styles.cooldownBody}>
            For your safety, money actions are disabled for 24 hours after signing in on a new device.
            Browsing and chat work normally.
          </Text>
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }}>
        {error ? (
          <Text style={[styles.muted, { color: motion.color.danger }]}>{error}</Text>
        ) : jobs === null ? (
          <ActivityIndicator />
        ) : jobs.length === 0 ? (
          <Text style={styles.muted}>{i18n.t('ps', 'empty.no_jobs')}</Text>
        ) : (
          jobs.map((j) => (
            <JobCard key={j.id} job={j} onPress={() => setOpenJobId(j.id)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function JobCard({ job, onPress }: { job: Job; onPress: () => void }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        onPressIn();
        void haptic(motion.hapticToken.TAP_LIGHT);
      }}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.card, animatedStyle]}>
        <Text style={styles.title}>{job.title}</Text>
        <Text style={styles.muted}>
          {job.ratePkr} PKR / {job.rateUnit} · {job.status}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingHorizontal: 16, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  mascot: { width: 60, height: 60 },
  h1: { fontSize: 24, fontWeight: '700', color: motion.color.text },
  muted: { color: '#888', fontSize: 13 },
  cooldownBanner: {
    backgroundColor: '#fcefd9',
    padding: 14,
    borderRadius: motion.radius.md,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: motion.color.warning,
  },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: motion.color.surface,
    paddingVertical: 12,
    borderRadius: motion.radius.pill,
    alignItems: 'center',
  },
  actionBtnPrimary: { backgroundColor: motion.color.primary },
  actionBtnText: { color: motion.color.text, fontWeight: '600' },
  cooldownTitle: { fontWeight: '700', color: motion.color.warning, marginBottom: 4 },
  cooldownBody: { color: motion.color.text },
  card: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: motion.spacing.lg,
    marginVertical: motion.spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  title: { fontSize: 16, fontWeight: '600', color: motion.color.text, marginBottom: 4 },
});

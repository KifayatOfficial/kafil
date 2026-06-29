// Activity screen — shows both perspectives depending on which roles the user holds.
//   Worker:   "My applications" list
//   Employer: "My jobs" list (tap → MyJobApplicantsScreen with the accept buttons)
// Tabbed if the user holds both roles.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, type Lang } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale, useStateFlash } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';
import { MyJobApplicantsScreen } from './MyJobApplicantsScreen';

interface Application {
  id: string;
  jobId: string;
  status: string;
  createdAt: string;
  job: { id: string; title: string; ratePkr: number; rateUnit: string; status: string };
}

interface JobMine {
  id: string;
  title: string;
  ratePkr: number;
  rateUnit: string;
  status: string;
  headcount: number;
  slots: Array<{ id: string; status: string; assignedWorkerId: string | null; version: number; slotIndex: number }>;
  _count: { applications: number };
}

interface Props {
  onBack: () => void;
}

type Tab = 'worker' | 'employer';

export function MyActivityScreen({ onBack }: Props) {
  const { api, lang } = useAuth();
  const [roles, setRoles] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('worker');
  const [appsLoading, setAppsLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [apps, setApps] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<JobMine[]>([]);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  // Pick default tab from roles.
  useEffect(() => {
    (async () => {
      const me = await api.get<{ ok: true; user: { roles: Array<{ role: string }> } }>('/api/auth/me');
      const rs = (me.data as { user?: { roles?: Array<{ role: string }> } }).user?.roles ?? [];
      const list = rs.map((r) => r.role);
      setRoles(list);
      if (list.includes('worker')) setTab('worker');
      else if (list.includes('employer')) setTab('employer');
    })().catch(() => undefined);
  }, [api]);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    const r = await api.get<{ ok: true; applications: Application[] }>('/api/applications/mine');
    if (r.success) setApps((r.data as { applications: Application[] }).applications);
    setAppsLoading(false);
  }, [api]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    const r = await api.get<{ ok: true; jobs: JobMine[] }>('/api/jobs/mine');
    if (r.success) setJobs((r.data as { jobs: JobMine[] }).jobs);
    setJobsLoading(false);
  }, [api]);

  useEffect(() => {
    if (tab === 'worker' && roles.includes('worker')) void loadApps();
    if (tab === 'employer' && roles.includes('employer')) void loadJobs();
  }, [tab, roles, loadApps, loadJobs]);

  if (openJobId) {
    return (
      <MyJobApplicantsScreen
        jobId={openJobId}
        onBack={() => {
          setOpenJobId(null);
          // refresh employer view since slots may have changed
          if (tab === 'employer') void loadJobs();
        }}
      />
    );
  }

  const showTabs = roles.includes('worker') && roles.includes('employer');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>
        <Text style={styles.h1}>{i18n.t(lang, 'activity.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {showTabs ? (
        <View style={styles.tabs}>
          <TabButton label={i18n.t(lang, 'activity.applications')} active={tab === 'worker'} onPress={() => setTab('worker')} />
          <TabButton label={i18n.t(lang, 'activity.my_jobs')} active={tab === 'employer'} onPress={() => setTab('employer')} />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {tab === 'worker' ? (
          appsLoading ? (
            <SkeletonList rows={3} />
          ) : apps.length === 0 ? (
            <Text style={styles.muted}>{i18n.t(lang, 'activity.no_applications')}</Text>
          ) : (
            apps.map((a) => <ApplicationCard key={a.id} app={a} lang={lang} />)
          )
        ) : jobsLoading ? (
          <SkeletonList rows={3} />
        ) : jobs.length === 0 ? (
          <Text style={styles.muted}>{i18n.t(lang, 'activity.no_jobs')}</Text>
        ) : (
          jobs.map((j) => (
            <JobMineCard key={j.id} job={j} onPress={() => setOpenJobId(j.id)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  // §27 class-B — flash on tap so a local tab switch feels reactive.
  const { opacity, flash } = useStateFlash();
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => {
        flash();
        void haptic(motion.hapticToken.TAP_LIGHT);
        onPress();
      }}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Animated.View style={anim}>
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function ApplicationCard({ app, lang }: { app: Application; lang: Lang }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const statusColor =
    app.status === 'accepted'
      ? motion.color.primary
      : app.status === 'rejected'
        ? motion.color.danger
        : motion.color.text;
  return (
    <Pressable
      onPressIn={() => {
        onPressIn();
        void haptic(motion.hapticToken.TAP_LIGHT);
      }}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.card, animated]}>
        <Text style={styles.cardTitle}>{app.job.title}</Text>
        <Text style={styles.muted}>
          {app.job.ratePkr} PKR / {app.job.rateUnit}
        </Text>
        {/* §25.2 — status as dot + label, never colour alone. */}
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{app.status}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

void (null as unknown as Lang);

function JobMineCard({ job, onPress }: { job: JobMine; onPress: () => void }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const openSlots = job.slots.filter((s) => s.status === 'open').length;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        onPressIn();
        void haptic(motion.hapticToken.TAP_LIGHT);
      }}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.card, animated]}>
        <Text style={styles.cardTitle}>{job.title}</Text>
        <Text style={styles.muted}>
          {job.ratePkr} PKR / {job.rateUnit} · {job.status}
        </Text>
        <Text style={styles.muted}>
          {job._count.applications} applicant{job._count.applications === 1 ? '' : 's'} ·{' '}
          {openSlots}/{job.headcount} open
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  h1: { fontSize: 20, fontWeight: '700', color: motion.color.text },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.pill,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: motion.color.primary },
  tabText: { color: motion.color.text, fontWeight: '600' },
  tabTextActive: { color: 'white' },
  card: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: 16,
    marginVertical: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: motion.color.text, marginBottom: 4 },
  muted: { color: '#888', fontSize: 13, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },
});

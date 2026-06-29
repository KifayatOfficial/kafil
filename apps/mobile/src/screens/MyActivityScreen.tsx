// Activity screen — shows both perspectives depending on which roles the user holds.
//   Worker:   "My applications" list
//   Employer: "My jobs" list (tap → MyJobApplicantsScreen with the accept buttons)
// Tabbed if the user holds both roles.

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
import { motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
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
  const { api } = useAuth();
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
        <Pressable onPress={onBack} hitSlop={16}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← Back</Text>
        </Pressable>
        <Text style={styles.h1}>My activity</Text>
        <View style={{ width: 60 }} />
      </View>

      {showTabs ? (
        <View style={styles.tabs}>
          <TabButton label="Applications" active={tab === 'worker'} onPress={() => setTab('worker')} />
          <TabButton label="My jobs" active={tab === 'employer'} onPress={() => setTab('employer')} />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {tab === 'worker' ? (
          appsLoading ? (
            <ActivityIndicator />
          ) : apps.length === 0 ? (
            <Text style={styles.muted}>You haven't applied to anything yet.</Text>
          ) : (
            apps.map((a) => <ApplicationCard key={a.id} app={a} />)
          )
        ) : jobsLoading ? (
          <ActivityIndicator />
        ) : jobs.length === 0 ? (
          <Text style={styles.muted}>You haven't posted any jobs yet.</Text>
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
  return (
    <Pressable
      onPress={() => {
        void haptic(motion.hapticToken.TAP_LIGHT);
        onPress();
      }}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ApplicationCard({ app }: { app: Application }) {
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
          {app.job.ratePkr} PKR / {app.job.rateUnit} ·{' '}
          <Text style={{ color: statusColor, fontWeight: '600' }}>{app.status}</Text>
        </Text>
      </Animated.View>
    </Pressable>
  );
}

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
});

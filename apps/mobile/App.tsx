// First bootable shell: pings the API, shows the first job from packages/core's typed contract.
// Mascot Lottie + motion classes now wired (§27).
import { useEffect, useState } from 'react';
import { Pressable, Text, View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { KafilLottie } from './src/motion/KafilLottie';
import { usePressScale } from './src/motion/animations';
import { haptic } from './src/motion/feedback';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('./assets/lottie/mascot_idle.json');

type Job = {
  id: string;
  title: string;
  ratePkr: number;
  rateUnit: string;
  status: string;
};

const apiUrl = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl
  ?? 'http://localhost:3001';

export default function App() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/api/jobs`)
      .then((r) => r.json() as Promise<{ jobs: Job[] }>)
      .then((d) => setJobs(d.jobs))
      .catch((e: Error) => setError(e.message));
  }, []);

  const t = (k: Parameters<typeof i18n.t>[1]) => i18n.t('ps', k);

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />

      {/* §27.6 — mascot idle loop at top, class-E */}
      <View style={styles.mascotRow}>
        <KafilLottie
          source={mascotIdle}
          motionClass={motion.MotionClass.E_MASCOT}
          style={styles.mascot}
          loop
        />
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.h1}>{t('app.name')}</Text>
          <Text style={styles.muted}>Mobile shell — Expo Go can preview this.</Text>
        </View>
      </View>

      <ScrollView style={{ marginTop: 16, alignSelf: 'stretch' }}>
        {error ? (
          <Text style={[styles.muted, { color: motion.color.danger }]}>
            {i18n.t('ps', 'error.generic')}{'\n'}
            <Text style={{ fontSize: 11 }}>{error}</Text>
          </Text>
        ) : jobs === null ? (
          <ActivityIndicator />
        ) : jobs.length === 0 ? (
          <Text style={styles.muted}>{i18n.t('ps', 'empty.no_jobs')}</Text>
        ) : (
          jobs.map((j) => <JobCard key={j.id} job={j} />)
        )}
      </ScrollView>
    </View>
  );
}

// §27.3 class-A press feedback wired on each card.
function JobCard({ job }: { job: Job }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
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
  root: {
    flex: 1,
    backgroundColor: motion.color.bg,
    paddingTop: 60,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
  },
  mascotRow: { flexDirection: 'row', alignItems: 'center' },
  mascot: { width: 72, height: 72 },
  h1: { fontSize: 28, fontWeight: '700', color: motion.color.text },
  muted: { color: '#888', fontSize: 13 },
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

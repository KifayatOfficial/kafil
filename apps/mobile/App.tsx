// First bootable shell: pings the API, shows the first job from packages/core's typed contract.
// Markhor mascot Lottie + motion classes wire in once we add lottie-react-native + Reanimated (Tier-B).
import { useEffect, useState } from 'react';
import { Text, View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { i18n, motion } from '@kafil/core';

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
      <Text style={styles.h1}>{t('app.name')}</Text>
      <Text style={styles.muted}>Mobile shell — Expo Go can preview this.</Text>

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
          jobs.map((j) => (
            <View key={j.id} style={styles.card}>
              <Text style={styles.title}>{j.title}</Text>
              <Text style={styles.muted}>
                {j.ratePkr} PKR / {j.rateUnit} · {j.status}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
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

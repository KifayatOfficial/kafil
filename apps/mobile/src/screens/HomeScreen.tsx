// Authenticated home — job feed. Tapping a card opens JobDetailScreen.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
import { makeStyles, useTheme, ThemeToggle } from '../theme';
import { JobDetailScreen } from './JobDetailScreen';
import { PostJobScreen } from './PostJobScreen';
import { MyActivityScreen } from './MyActivityScreen';
import { ChatListScreen } from './ChatListScreen';
import { WalletScreen } from './WalletScreen';
import { ReferralScreen } from './ReferralScreen';
import { CommunityScreen } from './CommunityScreen';
import { ShopsScreen } from './ShopsScreen';
import { NearbyScreen } from './NearbyScreen';
import { SkeletonList } from '../components/Skeleton';
import { SyncIndicator } from '../components/SyncIndicator';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface Job {
  id: string;
  title: string;
  ratePkr: number;
  rateUnit: string;
  status: string;
  // Ranked feed sends `featured`; plain feed sends `featuredUntil` — derive a single flag.
  featured?: boolean;
  featuredUntil?: string | null;
}

type Modal = 'detail' | 'post' | 'activity' | 'chats' | 'wallet' | 'referrals' | 'community' | 'shops' | 'nearby';

export function HomeScreen() {
  const { api, signOut, inCooldown, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; jobs: Job[] }>('/api/jobs');
    if (r.success) setJobs((r.data as { jobs: Job[] }).jobs);
    else setError('Failed to load');
  }, [api]);

  // Pull-to-refresh — on flaky networks users need an explicit "check again" instead of
  // assuming the feed auto-updates. Clears any prior error so a recovered network heals.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    await load().catch(() => setError('Failed to load'));
    setRefreshing(false);
  }, [load]);

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

  if (modal === 'chats') {
    return <ChatListScreen onBack={() => setModal(null)} />;
  }

  if (modal === 'wallet') {
    return <WalletScreen onBack={() => setModal(null)} />;
  }

  if (modal === 'referrals') {
    return <ReferralScreen onBack={() => setModal(null)} />;
  }

  if (modal === 'community') {
    return <CommunityScreen onBack={() => setModal(null)} />;
  }

  if (modal === 'shops') {
    return <ShopsScreen onBack={() => setModal(null)} />;
  }

  if (modal === 'nearby') {
    // Tapping a nearby job opens its detail; shops/groups route to their pillars.
    return (
      <NearbyScreen
        onBack={() => setModal(null)}
        onOpen={(row) => {
          if (row.kind === 'job') { setOpenJobId(row.id); setModal(null); }
          else if (row.kind === 'shop') setModal('shops');
          else setModal('community');
        }}
      />
    );
  }

  const isEmployer = roles.includes('employer');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.E_MASCOT} style={styles.mascot} loop />
        <View style={{ flex: 1, marginStart: 10 }}>
          <Text style={styles.h1}>{i18n.t(lang, 'app.name')}</Text>
          {/* §13/§25.4 — global sync status; renders nothing when there's no queued work. */}
          <SyncIndicator />
        </View>
        <ThemeToggle />
        <Pressable onPress={() => void signOut()} hitSlop={10} accessibilityLabel={i18n.t(lang, 'common.sign_out')} style={{ marginStart: 12 }}>
          <Text style={{ color: colors.primary }}>{i18n.t(lang, 'common.sign_out')}</Text>
        </Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={() => setModal('activity')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'nav.activity')}>
          <Text style={styles.actionBtnText}>{i18n.t(lang, 'nav.activity')}</Text>
        </Pressable>
        <Pressable onPress={() => setModal('chats')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'nav.chats')}>
          <Text style={styles.actionBtnText}>{i18n.t(lang, 'nav.chats')}</Text>
        </Pressable>
        <Pressable onPress={() => setModal('community')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'community.title')}>
          <Text style={styles.actionBtnText}>👥</Text>
        </Pressable>
        <Pressable onPress={() => setModal('shops')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'shops.title')}>
          <Text style={styles.actionBtnText}>🏪</Text>
        </Pressable>
        <Pressable onPress={() => setModal('nearby')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'nearby.title')}>
          <Text style={styles.actionBtnText}>📍</Text>
        </Pressable>
        <Pressable onPress={() => setModal('wallet')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'wallet.title')}>
          <Text style={styles.actionBtnText}>💰</Text>
        </Pressable>
        <Pressable onPress={() => setModal('referrals')} style={styles.actionBtn} accessibilityLabel={i18n.t(lang, 'referral.title')}>
          <Text style={styles.actionBtnText}>🎁</Text>
        </Pressable>
        {isEmployer ? (
          <Pressable onPress={() => setModal('post')} style={[styles.actionBtn, styles.actionBtnPrimary]} accessibilityLabel={i18n.t(lang, 'nav.post_job')}>
            <Text style={[styles.actionBtnText, styles.actionBtnTextOnPrimary]}>{i18n.t(lang, 'nav.post_job')}</Text>
          </Pressable>
        ) : null}
      </View>

      {inCooldown ? (
        <View style={styles.cooldownBanner}>
          <Text style={styles.cooldownTitle}>{i18n.t(lang, 'security.cooldown_title')}</Text>
          <Text style={styles.cooldownBody}>{i18n.t(lang, 'security.cooldown_body')}</Text>
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={jobs?.length === 0 ? { flexGrow: 1 } : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {error ? (
          <Text style={[styles.muted, { color: colors.danger }]}>{error}</Text>
        ) : jobs === null ? (
          <SkeletonList rows={5} />
        ) : jobs.length === 0 ? (
          <EmptyJobs isEmployer={isEmployer} onPostJob={() => setModal('post')} />
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
  const styles = useStyles();
  const { scale, onPressIn, onPressOut } = usePressScale();
  const { lang } = useAuth();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // §6.1 — featured flag from either feed shape.
  const featured =
    job.featured === true ||
    (!!job.featuredUntil && new Date(job.featuredUntil).getTime() > Date.now());
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        onPressIn();
        void haptic(motion.hapticToken.TAP_LIGHT);
      }}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.card, featured && styles.cardFeatured, animatedStyle]}>
        {featured ? <Text style={styles.featuredBadge}>{i18n.t(lang, 'featured.badge')}</Text> : null}
        <Text style={styles.title}>{job.title}</Text>
        <Text style={styles.muted}>
          {job.ratePkr} PKR / {job.rateUnit} · {job.status}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// §25.4 — empty states are a UX surface, not an error. Instead of a bare "no jobs"
// line, give the user a friendly mascot + concrete next steps so a quiet day reads as
// "nothing yet, here's what to do" rather than "the app is broken".
function EmptyJobs({ isEmployer, onPostJob }: { isEmployer: boolean; onPostJob: () => void }) {
  const styles = useStyles();
  const { lang } = useAuth();
  return (
    <View style={styles.emptyWrap}>
      <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.E_MASCOT} style={styles.emptyMascot} loop />
      <Text style={styles.emptyTitle}>{i18n.t(lang, 'empty.no_jobs')}</Text>
      <Text style={styles.emptyHint}>{i18n.t(lang, 'empty.jobs_hint')}</Text>
      <View style={styles.emptyTips}>
        <Text style={styles.emptyTip}>📍 {i18n.t(lang, 'empty.tip_radius')}</Text>
        <Text style={styles.emptyTip}>🕐 {i18n.t(lang, 'empty.tip_time')}</Text>
        <Text style={styles.emptyTip}>🔔 {i18n.t(lang, 'empty.tip_notify')}</Text>
      </View>
      {/* An employer staring at an empty feed is a prompt to post — close the loop. */}
      {isEmployer ? (
        <Pressable onPress={onPostJob} style={styles.emptyCta} accessibilityLabel={i18n.t(lang, 'nav.post_job')}>
          <Text style={styles.emptyCtaText}>{i18n.t(lang, 'nav.post_job')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingHorizontal: t.spacing.lg, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.lg },
  mascot: { width: 60, height: 60 },
  h1: { ...t.type.h1, color: t.colors.text },
  muted: { ...t.type.caption, color: t.colors.textMuted },
  cooldownBanner: {
    backgroundColor: t.colors.warningSoft,
    padding: 14,
    borderRadius: t.radius.lg,
    marginBottom: t.spacing.lg,
    borderWidth: 1,
    borderColor: t.colors.warning,
    ...t.elevation(1),
  },
  actionRow: { flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.md },
  actionBtn: {
    flex: 1,
    backgroundColor: t.colors.surface,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  actionBtnPrimary: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  actionBtnText: { ...t.type.label, color: t.colors.text },
  actionBtnTextOnPrimary: { color: t.colors.textOnPrimary },
  cooldownTitle: { ...t.type.title, color: t.colors.warning, marginBottom: t.spacing.xs },
  cooldownBody: { ...t.type.body, color: t.colors.text },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    marginVertical: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  cardFeatured: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
  featuredBadge: { ...t.type.caption, color: t.colors.primary, fontWeight: '700', marginBottom: t.spacing.xs },
  title: { ...t.type.title, color: t.colors.text, marginBottom: t.spacing.xs },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: t.spacing.xxl },
  emptyMascot: { width: 120, height: 120 },
  emptyTitle: { ...t.type.h2, color: t.colors.text, marginTop: t.spacing.md, textAlign: 'center' },
  emptyHint: { ...t.type.body, color: t.colors.textMuted, marginTop: t.spacing.xs, textAlign: 'center' },
  emptyTips: { marginTop: t.spacing.lg, gap: t.spacing.sm, alignSelf: 'stretch', paddingHorizontal: t.spacing.xl },
  emptyTip: {
    ...t.type.body,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
  },
  emptyCta: {
    marginTop: t.spacing.xl,
    backgroundColor: t.colors.primary,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xxl,
    borderRadius: t.radius.pill,
    ...t.elevation(2),
  },
  emptyCtaText: { ...t.type.label, color: t.colors.textOnPrimary, fontSize: 16 },
}));

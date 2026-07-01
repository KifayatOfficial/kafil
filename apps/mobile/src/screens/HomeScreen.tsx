// Authenticated home — job feed. Tapping a card opens JobDetailScreen.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { listItemIn } from '../motion/entrances';
import { useReduceMotion } from '../motion/reduceMotion';
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
import { StatefulView } from '../components/StatefulView';
import { SyncIndicator } from '../components/SyncIndicator';
import { Badge } from '../components/Badge';
import { useUnreadCount } from '../realtime/useUnreadCount';
import { CoachMark, useCoachMark } from '../mascot';
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
  const { api, inCooldown, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  // Live unread-chat count for the header badge (§27/1.2). Refreshes on SSE hint.
  const { count: unread, refresh: refreshUnread } = useUnreadCount();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Real balance for the header chip — same /api/wallet endpoint WalletScreen already
  // uses. Intentionally NOT a fabricated "this week" trend; we only show what the ledger
  // actually knows. Silent-fails to null (chip just doesn't render) rather than blocking
  // the feed on a second network round-trip.
  const [walletBalanceMinor, setWalletBalanceMinor] = useState<string | null>(null);
  // §P1.4 — infinite scroll. nextCursor is set only on the plain (non-ranked) feed; the
  // ranked feed returns its whole scored slice in one shot (no cursor → no paging).
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // First-run coaching: once a worker's feed has loaded with jobs, point them at tapping
  // one. Shows at most once ever (persisted), and never to employers (they get the
  // post-job on-ramp instead). No modal open so it doesn't fight a sub-screen.
  const isWorker = roles.includes('worker');
  const feedReadyWithJobs = jobs !== null && jobs.length > 0 && modal === null && !openJobId;
  const firstApplyCoach = useCoachMark('home.first_apply', isWorker && feedReadyWithJobs);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; jobs: Job[]; nextCursor?: string | null }>('/api/jobs');
    if (r.success) {
      const data = r.data as { jobs: Job[]; nextCursor?: string | null };
      setJobs(data.jobs);
      setNextCursor(data.nextCursor ?? null);
    } else setError('Failed to load');
  }, [api]);

  // Append the next page when the user nears the end. Dedupes by id so a row that shifted
  // between pages (new insert) never appears twice. No-op when there's no cursor (ranked
  // feed, or end of the plain feed reached).
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.get<{ ok: true; jobs: Job[]; nextCursor?: string | null }>(
        `/api/jobs?cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (r.success) {
        const data = r.data as { jobs: Job[]; nextCursor?: string | null };
        setJobs((cur) => {
          const have = new Set((cur ?? []).map((j) => j.id));
          const fresh = data.jobs.filter((j) => !have.has(j.id));
          return [...(cur ?? []), ...fresh];
        });
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [api, nextCursor, loadingMore]);

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
      if (list.includes('worker')) {
        const w = await api.get<{ ok: true; wallet: { balanceMinor: string } }>('/api/wallet').catch(() => null);
        if (w?.success) setWalletBalanceMinor((w.data as { wallet: { balanceMinor: string } }).wallet.balanceMinor);
      }
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
    // Refresh the header badge on return — threads opened in the list get marked read.
    return <ChatListScreen onBack={() => { setModal(null); refreshUnread(); }} />;
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
        {/* Real wallet balance (not a fabricated trend) — the thing a worker checks first
            on open. Tapping opens the existing WalletScreen; nothing new is invented here,
            just surfaced a hop earlier than "You → Wallet". */}
        {walletBalanceMinor !== null ? (
          <Pressable onPress={() => setModal('wallet')} style={styles.walletChip} accessibilityLabel={i18n.t(lang, 'wallet.title')}>
            <Ionicons name="wallet-outline" size={14} color={colors.primary} />
            <Text style={styles.walletChipText}>{Math.floor(Number(walletBalanceMinor) / 100).toLocaleString('en-US')}</Text>
          </Pressable>
        ) : null}
        {/* §27 Portal: community/shops/nearby/wallet/etc. now live in the bottom tab bar
            + the "You" hub, so the Home header keeps only chat (the one cross-cutting
            action that isn't its own tab) + theme. */}
        <Pressable onPress={() => setModal('chats')} hitSlop={10} accessibilityLabel={i18n.t(lang, 'nav.chats')} style={{ marginStart: 8 }}>
          <Ionicons name="chatbubble-outline" size={22} color={colors.text} />
          <Badge count={unread} />
        </Pressable>
        <ThemeToggle />
      </View>

      {inCooldown ? (
        <View style={styles.cooldownBanner}>
          <Text style={styles.cooldownTitle}>{i18n.t(lang, 'security.cooldown_title')}</Text>
          <Text style={styles.cooldownBody}>{i18n.t(lang, 'security.cooldown_body')}</Text>
        </View>
      ) : null}

      {jobs && jobs.length > 0 ? (
        // §P1.3 — FlashList virtualizes the feed so a long list stays at 60fps and flat
        // memory on low-RAM Androids (a ScrollView-of-cards would crash there at scale).
        <FlashList
          data={jobs}
          keyExtractor={(j) => j.id}
          renderItem={({ item, index }) => <JobCard job={item} index={index} onPress={() => setOpenJobId(item.id)} />}
          estimatedItemSize={120}
          contentContainerStyle={{ paddingBottom: 24 }}
          // §P1.4 — infinite scroll: pull the next keyset page as the user nears the end.
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
        />
      ) : (
        // Loading / error / empty: StatefulView owns these (mascot + retry + on-ramp).
        // Kept in a ScrollView so pull-to-refresh works even on the empty/error screens.
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          <StatefulView
            status={jobs === null ? (error ? 'error' : 'loading') : 'ready'}
            error={error}
            onRetry={() => setReloadKey((k) => k + 1)}
            empty={jobs !== null && jobs.length === 0}
            emptyTitle={i18n.t(lang, 'empty.no_jobs')}
            emptyHint={i18n.t(lang, 'empty.jobs_hint')}
            emptyTips={[
              `📍 ${i18n.t(lang, 'empty.tip_radius')}`,
              `🕐 ${i18n.t(lang, 'empty.tip_time')}`,
              `🔔 ${i18n.t(lang, 'empty.tip_notify')}`,
            ]}
            emptyAction={isEmployer ? { label: i18n.t(lang, 'nav.post_job'), onPress: () => setModal('post') } : undefined}
          >
            {null}
          </StatefulView>
        </ScrollView>
      )}

      {firstApplyCoach.show ? (
        <CoachMark message={i18n.t(lang, 'coach.first_apply')} onDismiss={firstApplyCoach.dismiss} />
      ) : null}
    </View>
  );
}

function JobCard({ job, index, onPress }: { job: Job; index: number; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale();
  const { lang } = useAuth();
  const reduce = useReduceMotion();
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
      {/* §27 — staggered fade+rise entrance (reduce-motion aware). Makes the feed feel
          alive on open without being gratuitous; delay caps so long lists don't lag. */}
      <Animated.View
        entering={listItemIn(reduce, index)}
        style={[styles.card, featured && styles.cardFeatured, animatedStyle]}
      >
        <View style={[styles.cardIconTile, featured && styles.cardIconTileFeatured]}>
          <Ionicons name="briefcase-outline" size={20} color={featured ? colors.textOnPrimary : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          {featured ? <Text style={styles.featuredBadge}>{i18n.t(lang, 'featured.badge')}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
          <View style={styles.cardMetaRow}>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{job.status}</Text>
            </View>
            <Text style={styles.muted}>{job.rateUnit}</Text>
          </View>
        </View>
        <Text style={styles.price}>{job.ratePkr.toLocaleString('en-US')} PKR</Text>
      </Animated.View>
    </Pressable>
  );
}

// Empty/loading/error states are handled by <StatefulView> (§25.4) — the friendly
// mascot + tips + employer "post a job" on-ramp now lives there, reused across screens.

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingHorizontal: t.spacing.lg, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.lg },
  mascot: { width: 60, height: 60 },
  h1: { ...t.type.h1, color: t.colors.text },
  muted: { ...t.type.caption, color: t.colors.textMuted },
  walletChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.colors.primarySoft,
    borderRadius: t.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginStart: 8,
  },
  walletChipText: { ...t.type.label, color: t.colors.primary },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.md,
    marginVertical: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  cardFeatured: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
  cardIconTile: {
    width: 44,
    height: 44,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconTileFeatured: { backgroundColor: t.colors.primary },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.xs },
  statusPill: {
    backgroundColor: t.colors.surfaceSunken,
    borderRadius: t.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPillText: { ...t.type.micro, color: t.colors.textMuted, textTransform: 'capitalize' },
  price: { ...t.type.label, color: t.colors.primary, fontWeight: '700' },
  featuredBadge: { ...t.type.caption, color: t.colors.primary, fontWeight: '700', marginBottom: t.spacing.xs },
  title: { ...t.type.title, color: t.colors.text },
}));

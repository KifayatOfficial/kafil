// The "You" tab — the personal hub. Consolidates the secondary actions that used to
// crowd the Home action row (wallet, activity, referrals, post-a-job, sign out) into a
// clean, animated list. Part of the §27 "Portal" restructure (bottom-tab nav).
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { listItemIn } from '../motion/entrances';
import { useReduceMotion } from '../motion/reduceMotion';
import { ThemeToggle } from '../theme';
import { makeStyles, useTheme } from '../theme';
import { WalletScreen } from './WalletScreen';
import { MyActivityScreen } from './MyActivityScreen';
import { ReferralScreen } from './ReferralScreen';
import { PostJobScreen } from './PostJobScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { Badge } from '../components/Badge';
import { useNotificationCount } from '../realtime/useNotificationCount';

type Route = 'wallet' | 'activity' | 'referrals' | 'post' | 'notifications';

interface Row {
  route: Route;
  icon: string;
  label: string;
  employerOnly?: boolean;
  badge?: number;
}

export function ProfileHubScreen() {
  const { api, signOut, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const [roles, setRoles] = useState<string[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const { count: notifUnread, refresh: refreshNotif } = useNotificationCount();

  useEffect(() => {
    (async () => {
      const me = await api.get<{ ok: true; user: { roles?: Array<{ role: string }>; displayName?: string } }>('/api/auth/me');
      const list = ((me.data as { user?: { roles?: Array<{ role: string }> } }).user?.roles ?? []).map((r) => r.role);
      setRoles(list);
    })().catch(() => undefined);
  }, [api]);

  if (route === 'wallet') return <WalletScreen onBack={() => setRoute(null)} />;
  if (route === 'activity') return <MyActivityScreen onBack={() => setRoute(null)} />;
  if (route === 'referrals') return <ReferralScreen onBack={() => setRoute(null)} />;
  if (route === 'post') return <PostJobScreen onClose={() => setRoute(null)} onPosted={() => setRoute(null)} />;
  if (route === 'notifications')
    return <NotificationsScreen onBack={() => { setRoute(null); refreshNotif(); }} onChanged={refreshNotif} />;

  const isEmployer = roles.includes('employer');
  const rows: Row[] = [
    { route: 'notifications', icon: '🔔', label: i18n.t(lang, 'notifications.title'), badge: notifUnread },
    { route: 'activity', icon: '📋', label: i18n.t(lang, 'activity.title') },
    { route: 'wallet', icon: '💰', label: i18n.t(lang, 'wallet.title') },
    { route: 'referrals', icon: '🎁', label: i18n.t(lang, 'referral.title') },
    { route: 'post', icon: '➕', label: i18n.t(lang, 'job.post_title'), employerOnly: true },
  ];
  const visible = rows.filter((r) => !r.employerOnly || isEmployer);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>{i18n.t(lang, 'nav.you')}</Text>
        <ThemeToggle accessibilityLabel={i18n.t(lang, 'nav.you')} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {visible.map((r, i) => (
          <Animated.View key={r.route} entering={listItemIn(reduce, i)}>
            <Pressable
              onPress={() => {
                void haptic(motion.hapticToken.TAP_LIGHT);
                setRoute(r.route);
              }}
              style={styles.row}
              accessibilityLabel={r.label}
            >
              <View>
                <Text style={styles.icon}>{r.icon}</Text>
                {r.badge ? <Badge count={r.badge} /> : null}
              </View>
              <Text style={styles.label}>{r.label}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Animated.View>
        ))}

        <Animated.View entering={listItemIn(reduce, visible.length)}>
          <Pressable
            onPress={() => void signOut()}
            style={[styles.row, styles.signOutRow]}
            accessibilityLabel={i18n.t(lang, 'common.sign_out')}
          >
            <Text style={styles.icon}>🚪</Text>
            <Text style={[styles.label, { color: colors.danger }]}>{i18n.t(lang, 'common.sign_out')}</Text>
            <View style={{ width: 16 }} />
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  h1: { ...t.type.h1, color: t.colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: t.spacing.lg,
    marginBottom: t.spacing.sm,
    ...t.elevation(1),
  },
  signOutRow: { marginTop: t.spacing.lg },
  icon: { fontSize: 22 },
  label: { ...t.type.title, color: t.colors.text, flex: 1 },
  chevron: { fontSize: 24, color: t.colors.primary },
}));

// §27 "Portal" — the authenticated app shell: a bottom-tab navigator that replaces the
// old crowded Home action row (8 buttons) with 5 clear pillars. Each tab's screen is
// kept mounted after first visit (cheap state preservation; low-end friendly since we
// only ever mount what's been opened). The active tab animates; motion respects
// reduce-motion via the shared entrance system.
//
// Tabs: Home (job feed) · Community · Shops · Nearby · You (personal hub).
// Chat is reachable from the Home header (a 💬 button) — kept off the tab bar to hold
// the bar at the 5-item mobile sweet spot.

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { useReduceMotion } from '../motion/reduceMotion';
import { makeStyles, useTheme } from '../theme';
import { GlassSurface } from '../components/GlassSurface';
import { Badge } from '../components/Badge';
import { useNotificationCount } from '../realtime/useNotificationCount';
import { HomeScreen } from './HomeScreen';
import { CommunityScreen } from './CommunityScreen';
import { ShopsScreen } from './ShopsScreen';
import { NearbyScreen } from './NearbyScreen';
import { ProfileHubScreen } from './ProfileHubScreen';

type Tab = 'home' | 'community' | 'shops' | 'nearby' | 'you';

const TABS: Array<{
  key: Tab;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  labelKey: Parameters<typeof i18n.t>[1];
}> = [
  { key: 'home', icon: 'home-outline', iconActive: 'home', labelKey: 'nav.home' },
  { key: 'community', icon: 'people-outline', iconActive: 'people', labelKey: 'community.title' },
  { key: 'shops', icon: 'storefront-outline', iconActive: 'storefront', labelKey: 'shops.title' },
  { key: 'nearby', icon: 'location-outline', iconActive: 'location', labelKey: 'nearby.title' },
  { key: 'you', icon: 'person-outline', iconActive: 'person', labelKey: 'nav.you' },
];

export function PortalShell() {
  const { lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const { count: notifUnread } = useNotificationCount();
  const [tab, setTab] = useState<Tab>('home');
  // Lazy-mount: only tabs that have been visited exist. Once mounted, a tab stays mounted
  // (hidden via display:none) so its scroll position + fetched data survive tab switches.
  const [visited, setVisited] = useState<Set<Tab>>(new Set(['home']));

  const go = (next: Tab) => {
    if (next === tab) return;
    void haptic(motion.hapticToken.TAP_LIGHT);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
    setTab(next);
  };

  return (
    <View style={styles.root}>
      {/* Each visited tab is kept mounted; only the active one is visible. Bottom padding
          on the body clears the floating bar so the last list row is never hidden under it. */}
      <View style={styles.body}>
        {visited.has('home') ? <Pane active={tab === 'home'}><HomeScreen /></Pane> : null}
        {visited.has('community') ? <Pane active={tab === 'community'}><CommunityScreen onBack={() => go('home')} /></Pane> : null}
        {visited.has('shops') ? <Pane active={tab === 'shops'}><ShopsScreen onBack={() => go('home')} /></Pane> : null}
        {visited.has('nearby') ? <Pane active={tab === 'nearby'}><NearbyScreen onBack={() => go('home')} /></Pane> : null}
        {visited.has('you') ? <Pane active={tab === 'you'}><ProfileHubScreen /></Pane> : null}
      </View>

      {/* Floating glass tab bar — inset from the edges (a "bubble", not pinned to the
          bezel), per current platform glass guidance. Content scrolls fully behind it;
          each screen accounts for the ~92px clearance via styles.body's bottom inset. */}
      <View style={styles.tabBarWrap} pointerEvents="box-none">
        <GlassSurface style={styles.tabBar} intensity={55}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <TabButton
                key={t.key}
                active={active}
                icon={active ? t.iconActive : t.icon}
                label={i18n.t(lang, t.labelKey)}
                activeColor={colors.primary}
                inactiveColor={colors.textFaint}
                badge={t.key === 'you' ? notifUnread : 0}
                onPress={() => go(t.key)}
              />
            );
          })}
        </GlassSurface>
      </View>
    </View>
  );
}

function TabButton({
  active,
  icon,
  label,
  activeColor,
  inactiveColor,
  badge = 0,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  activeColor: string;
  inactiveColor: string;
  badge?: number;
  onPress: () => void;
}) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const pillStyle = useAnimatedStyle(() => ({
    opacity: withSpring(active ? 1 : 0, reduce ? { duration: 0 } : motion.motionEasing.springResponsive),
    transform: [{ scale: withSpring(active ? 1 : 0.7, reduce ? { duration: 0 } : motion.motionEasing.springResponsive) }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <View style={styles.tabHitArea}>
        <Animated.View style={[styles.activePill, pillStyle]} />
        <Ionicons name={icon} size={20} color={active ? activeColor : inactiveColor} style={styles.tabIconOverlay} />
        <Badge count={badge} />
      </View>
      {active ? (
        <Text style={[styles.tabLabel, { color: activeColor }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A tab pane — mounted once visited, hidden (not unmounted) when inactive. */
function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  // display:none keeps it out of layout + paint while preserving component state.
  return <View style={active ? paneStyle.on : paneStyle.off}>{children}</View>;
}

const paneStyle = {
  on: { flex: 1 } as const,
  off: { display: 'none' as const },
};

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  body: { flex: 1, paddingBottom: 92 },
  tabBarWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 6,
    ...t.elevation(3),
  },
  tab: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4, minWidth: 44 },
  tabHitArea: { alignItems: 'center', justifyContent: 'center', width: 40, height: 32 },
  activePill: {
    position: 'absolute',
    width: 40,
    height: 32,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.primarySoft,
  },
  tabIconOverlay: {},
  tabLabel: { ...t.type.micro, marginTop: 2 },
}));

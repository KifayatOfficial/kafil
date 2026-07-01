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
import Animated from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { fadeIn } from '../motion/entrances';
import { useReduceMotion } from '../motion/reduceMotion';
import { makeStyles, useTheme } from '../theme';
import { HomeScreen } from './HomeScreen';
import { CommunityScreen } from './CommunityScreen';
import { ShopsScreen } from './ShopsScreen';
import { NearbyScreen } from './NearbyScreen';
import { ProfileHubScreen } from './ProfileHubScreen';

type Tab = 'home' | 'community' | 'shops' | 'nearby' | 'you';

const TABS: Array<{ key: Tab; icon: string; labelKey: Parameters<typeof i18n.t>[1] }> = [
  { key: 'home', icon: '🏠', labelKey: 'nav.home' },
  { key: 'community', icon: '👥', labelKey: 'community.title' },
  { key: 'shops', icon: '🏪', labelKey: 'shops.title' },
  { key: 'nearby', icon: '📍', labelKey: 'nearby.title' },
  { key: 'you', icon: '🙂', labelKey: 'nav.you' },
];

export function PortalShell() {
  const { lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const reduce = useReduceMotion();
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
      {/* Each visited tab is kept mounted; only the active one is visible. */}
      <View style={styles.body}>
        {visited.has('home') ? <Pane active={tab === 'home'}><HomeScreen /></Pane> : null}
        {visited.has('community') ? <Pane active={tab === 'community'}><CommunityScreen onBack={() => go('home')} /></Pane> : null}
        {visited.has('shops') ? <Pane active={tab === 'shops'}><ShopsScreen onBack={() => go('home')} /></Pane> : null}
        {visited.has('nearby') ? <Pane active={tab === 'nearby'}><NearbyScreen onBack={() => go('home')} /></Pane> : null}
        {visited.has('you') ? <Pane active={tab === 'you'}><ProfileHubScreen /></Pane> : null}
      </View>

      {/* Bottom tab bar. */}
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => go(t.key)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={i18n.t(lang, t.labelKey)}
            >
              {active ? (
                <Animated.View entering={fadeIn(reduce)} style={styles.activePip} />
              ) : (
                <View style={styles.pipSpacer} />
              )}
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                {i18n.t(lang, t.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: t.colors.surface,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    paddingBottom: 8,
    paddingTop: 6,
    ...t.elevation(2),
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  activePip: { width: 20, height: 3, borderRadius: 2, backgroundColor: t.colors.primary, marginBottom: 3 },
  pipSpacer: { height: 3, marginBottom: 3 },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
  tabLabel: { ...t.type.micro, color: t.colors.textMuted },
  tabLabelActive: { color: t.colors.primary },
}));

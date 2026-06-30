// §6 — DISCOVERY: "what's near me" across jobs + shops + groups, distance-sorted, with
// a kind filter. This is the list form of the map view — honest for low-end/offline
// devices (§6 names offline-first), and a real map (react-native-maps) can layer on top
// later reading the same /api/discovery/nearby data (each row carries lat/lng).
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';
import { makeStyles, useTheme } from '../theme';

interface NearbyRow { id: string; kind: 'job' | 'shop' | 'group'; title: string; subtitle: string | null; distanceM: number }
type Filter = 'all' | 'job' | 'shop' | 'group';

const KIND_ICON: Record<NearbyRow['kind'], string> = { job: '🔨', shop: '🏪', group: '👥' };

interface Props {
  onBack: () => void;
  /** Open a job/shop/group when tapped (caller routes by kind). Optional. */
  onOpen?: (row: NearbyRow) => void;
}

export function NearbyScreen({ onBack, onOpen }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [rows, setRows] = useState<NearbyRow[] | null>(null);
  const [located, setLocated] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; located: boolean; results: NearbyRow[] }>('/api/discovery/nearby');
    if (r.success) {
      const data = r.data as { located: boolean; results: NearbyRow[] };
      setLocated(data.located);
      setRows(data.results);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  }, [load]);

  const filtered = (rows ?? []).filter((r) => filter === 'all' || r.kind === filter);
  const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>
        <Text style={styles.h1}>📍 {i18n.t(lang, 'nearby.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterRow}>
        {(['all', 'job', 'shop', 'group'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => { void haptic(motion.hapticToken.TAP_LIGHT); setFilter(f); }}
            style={[styles.chip, filter === f && styles.chipActive]}
            accessibilityState={{ selected: filter === f }}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f === 'all' ? i18n.t(lang, 'nearby.all') : i18n.t(lang, f === 'job' ? 'nearby.jobs' : f === 'shop' ? 'nearby.shops' : 'nearby.groups')}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        {rows === null ? (
          <SkeletonList rows={5} />
        ) : !located ? (
          <Text style={styles.muted}>{i18n.t(lang, 'nearby.no_location')}</Text>
        ) : filtered.length === 0 ? (
          <Text style={styles.muted}>{i18n.t(lang, 'nearby.none')}</Text>
        ) : (
          filtered.map((r) => (
            <Pressable key={`${r.kind}:${r.id}`} onPress={() => onOpen?.(r)} style={styles.card}>
              <Text style={styles.icon}>{KIND_ICON[r.kind]}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{r.title}</Text>
                {r.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{r.subtitle}</Text> : null}
              </View>
              <Text style={styles.dist}>{km(r.distanceM)}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  h1: { ...t.type.h2, color: t.colors.text },
  filterRow: { flexDirection: 'row', gap: t.spacing.sm, paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  chip: { backgroundColor: t.colors.surface, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: t.spacing.md, paddingVertical: 6 },
  chipActive: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  chipText: { ...t.type.caption, color: t.colors.text },
  chipTextActive: { color: t.colors.textOnPrimary },
  muted: { ...t.type.body, color: t.colors.textMuted, textAlign: 'center', marginTop: t.spacing.xl },
  card: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.lg, marginBottom: t.spacing.sm, ...t.elevation(1) },
  icon: { fontSize: 22 },
  title: { ...t.type.title, color: t.colors.text },
  subtitle: { ...t.type.caption, color: t.colors.textMuted, marginTop: 2 },
  dist: { ...t.type.micro, color: t.colors.primary },
}));

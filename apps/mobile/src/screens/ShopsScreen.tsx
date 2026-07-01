// §5 — shop directory: list/search shops, list your own, create a shop, open detail.
// The 3rd platform pillar's entry point (alongside the gig feed + community).
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';
import { ShopDetailScreen } from './ShopDetailScreen';
import { makeStyles, useTheme } from '../theme';

interface ShopRow {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  verifiedTier: string;
  rating: number;
  location: { label: string; district: string | null } | null;
}

interface Props {
  onBack: () => void;
}

export function ShopsScreen({ onBack }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; shops: ShopRow[]; nextCursor?: string | null }>('/api/shops');
    if (r.success) {
      const data = r.data as { shops: ShopRow[]; nextCursor?: string | null };
      setShops(data.shops);
      setNextCursor(data.nextCursor ?? null);
    }
  }, [api]);

  // §P1.4b — append the next rating-keyed page as the directory scrolls; dedupe by id.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.get<{ ok: true; shops: ShopRow[]; nextCursor?: string | null }>(
        `/api/shops?cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (r.success) {
        const data = r.data as { shops: ShopRow[]; nextCursor?: string | null };
        setShops((cur) => {
          const have = new Set((cur ?? []).map((s) => s.id));
          return [...(cur ?? []), ...data.shops.filter((s) => !have.has(s.id))];
        });
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [api, nextCursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  }, [load]);

  const create = async () => {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(
      '/api/shops',
      {
        name: name.trim(),
        description: desc.trim() || undefined,
        categories: cat.trim() ? [cat.trim().toLowerCase()] : [],
      },
      { idempotencyKey: randomUUID() },
    );
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setName(''); setDesc(''); setCat(''); setCreating(false);
      await load();
    }
    setBusy(false);
  };

  if (openId) {
    return <ShopDetailScreen shopId={openId} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
          </Pressable>
          <Text style={styles.h1}>{i18n.t(lang, 'shops.title')}</Text>
          <Pressable onPress={() => setCreating((c) => !c)} hitSlop={10} accessibilityLabel={i18n.t(lang, 'shops.create')}>
            <Text style={{ color: colors.primary }}>{i18n.t(lang, 'shops.create')}</Text>
          </Pressable>
        </View>

        {creating ? (
          <View style={styles.createCard}>
            <TextInput value={name} onChangeText={setName} placeholder={i18n.t(lang, 'shops.name_ph')} placeholderTextColor={colors.textFaint} style={styles.input} maxLength={200} />
            <TextInput value={cat} onChangeText={setCat} placeholder={i18n.t(lang, 'shops.category_ph')} placeholderTextColor={colors.textFaint} style={[styles.input, { marginTop: 8 }]} maxLength={40} autoCapitalize="none" />
            <TextInput value={desc} onChangeText={setDesc} placeholder={i18n.t(lang, 'shops.desc_ph')} placeholderTextColor={colors.textFaint} style={[styles.input, { marginTop: 8 }]} maxLength={500} />
            <Pressable onPress={create} disabled={name.trim().length < 2 || busy} style={[styles.createBtn, (name.trim().length < 2 || busy) && styles.createBtnDisabled]}>
              {busy ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.createBtnText}>{i18n.t(lang, 'shops.create_title')}</Text>}
            </Pressable>
          </View>
        ) : null}

        {shops && shops.length > 0 ? (
          // §P1.3b — FlashList virtualizes the directory (8k+ shops targeted year 1).
          <FlashList
            data={shops}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => <ShopCard shop={item} onPress={() => setOpenId(item.id)} />}
            estimatedItemSize={96}
            contentContainerStyle={{ padding: 16 }}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          >
            {shops === null ? (
              <SkeletonList rows={4} />
            ) : (
              <Text style={styles.muted}>{i18n.t(lang, 'shops.none')}</Text>
            )}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function ShopCard({ shop: s, onPress }: { shop: ShopRow; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{s.name}</Text>
          {s.verifiedTier !== 'free' ? <Text style={styles.verified}>✓</Text> : null}
        </View>
        {s.description ? <Text style={styles.desc} numberOfLines={1}>{s.description}</Text> : null}
        <Text style={styles.meta}>
          ★ {s.rating.toFixed(1)}
          {s.categories[0] ? ` · ${s.categories[0]}` : ''}
          {s.location?.district ? ` · ${s.location.district}` : ''}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  h1: { ...t.type.h2, color: t.colors.text },
  muted: { ...t.type.body, color: t.colors.textMuted, textAlign: 'center', marginTop: t.spacing.xl },
  createCard: { marginHorizontal: t.spacing.lg, marginBottom: t.spacing.sm, backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.md },
  input: { backgroundColor: t.colors.bg, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12, paddingVertical: 10, color: t.colors.text },
  createBtn: { backgroundColor: t.colors.primary, borderRadius: t.radius.pill, paddingVertical: 12, alignItems: 'center', marginTop: t.spacing.sm },
  createBtnDisabled: { backgroundColor: t.colors.skeleton },
  createBtnText: { ...t.type.label, color: t.colors.textOnPrimary },
  card: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.lg, marginBottom: t.spacing.sm, ...t.elevation(1) },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs },
  name: { ...t.type.title, color: t.colors.text },
  verified: { ...t.type.label, color: t.colors.primary },
  desc: { ...t.type.caption, color: t.colors.textMuted, marginTop: 2 },
  meta: { ...t.type.micro, color: t.colors.textMuted, marginTop: t.spacing.xs },
  chevron: { fontSize: 24, color: t.colors.primary },
}));

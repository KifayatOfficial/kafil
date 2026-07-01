// §11 — the notification inbox. The read surface for the notifications the server already
// writes (applications, hires, nearby matches, etc.). Keyset-paginated (infinite scroll),
// unread rows visually weighted, tap-to-read, and a "mark all read" action. Opening the
// screen does NOT auto-read everything — a user should see what's new; reading is explicit
// (tap a row) or bulk (the header action), matching how the chat unread cursor works.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { StatefulView } from '../components/StatefulView';
import { makeStyles, useTheme } from '../theme';

interface Notif {
  id: string;
  type: string;
  priority: string;
  title: string | null;
  body: string | null;
  refType: string | null;
  refId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Props {
  onBack: () => void;
  /** Called after a read/mark-all so a parent badge can refresh. */
  onChanged?: () => void;
}

export function NotificationsScreen({ onBack, onChanged }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await api.get<{ ok: true; notifications: Notif[]; nextCursor: string | null }>(
      '/api/notifications?limit=20',
    );
    if (r.success) {
      const data = r.data as { notifications: Notif[]; nextCursor: string | null };
      setItems(data.notifications);
      setCursor(data.nextCursor);
    } else {
      setError('load_failed');
    }
  }, [api]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const r = await api.get<{ ok: true; notifications: Notif[]; nextCursor: string | null }>(
      `/api/notifications?limit=20&cursor=${encodeURIComponent(cursor)}`,
    );
    if (r.success) {
      const data = r.data as { notifications: Notif[]; nextCursor: string | null };
      // Dedupe by id (a row inserted between pages could otherwise repeat).
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((n) => n.id));
        return [...(prev ?? []), ...data.notifications.filter((n) => !seen.has(n.id))];
      });
      setCursor(data.nextCursor);
    }
    setLoadingMore(false);
  }, [api, cursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  }, [load]);

  const markOneRead = useCallback(
    (id: string) => {
      // Optimistic: stamp locally, fire-and-forget the server call, refresh the badge.
      setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) ?? prev);
      void api.post(`/api/notifications/${id}/read`, {}).then(() => onChanged?.());
    },
    [api, onChanged],
  );

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? now })) ?? prev);
    void api.post('/api/notifications/read-all', {}).then(() => onChanged?.());
  }, [api, onChanged]);

  const hasUnread = (items ?? []).some((n) => !n.readAt);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>
        <Text style={styles.h1}>{i18n.t(lang, 'notifications.title')}</Text>
        {hasUnread ? (
          <Pressable onPress={markAllRead} hitSlop={12} accessibilityLabel={i18n.t(lang, 'notifications.mark_all_read')}>
            <Text style={styles.markAll}>{i18n.t(lang, 'notifications.mark_all_read')}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <StatefulView
        status={items === null ? (error ? 'error' : 'loading') : 'ready'}
        empty={items?.length === 0}
        error={error}
        onRetry={load}
        emptyTitle={i18n.t(lang, 'notifications.empty')}
      >
        <FlashList
          data={items ?? []}
          keyExtractor={(n) => n.id}
          estimatedItemSize={76}
          contentContainerStyle={{ padding: 16 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
          renderItem={({ item }) => (
            <NotifRow
              title={item.title ?? item.type}
              body={item.body}
              when={relativeTime(item.createdAt, lang)}
              unread={!item.readAt}
              onPress={() => markOneRead(item.id)}
            />
          )}
        />
      </StatefulView>
    </View>
  );
}

function NotifRow({
  title,
  body,
  when,
  unread,
  onPress,
}: {
  title: string;
  body: string | null;
  when: string;
  unread: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { scale, onPressIn, onPressOut } = usePressScale();
  const a = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={[styles.row, unread && styles.rowUnread, a]}>
        {unread ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>
            {title}
          </Text>
          {body ? (
            <Text style={styles.rowBody} numberOfLines={2}>
              {body}
            </Text>
          ) : null}
        </View>
        <Text style={styles.when}>{when}</Text>
      </Animated.View>
    </Pressable>
  );
}

/** Tiny relative-time formatter — no dep, three-language "now / Nm / Nh / Nd". */
function relativeTime(iso: string, lang: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const now = lang === 'ur' ? 'ابھی' : lang === 'ps' ? 'اوس' : 'now';
  if (secs < 60) return now;
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  return `${days}d`;
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  },
  h1: { ...t.type.h2, color: t.colors.text },
  markAll: { ...t.type.caption, color: t.colors.primary, maxWidth: 90, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: t.spacing.lg,
    marginBottom: t.spacing.sm,
    ...t.elevation(1),
  },
  rowUnread: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.primary },
  dotSpacer: { width: 8 },
  rowTitle: { ...t.type.title, color: t.colors.text },
  rowTitleUnread: { fontWeight: '800' },
  rowBody: { ...t.type.caption, color: t.colors.textMuted, marginTop: 2 },
  when: { ...t.type.micro, color: t.colors.textFaint, marginStart: t.spacing.sm },
}));

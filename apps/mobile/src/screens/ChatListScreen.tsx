// Conversations list. Each conversation has the most-recent message preview embedded.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { ChatScreen } from './ChatScreen';
import { SkeletonList } from '../components/Skeleton';
import { makeStyles, useTheme } from '../theme';

interface Conversation {
  id: string;
  jobId: string | null;
  createdAt: string;
  participants: Array<{ userId: string; user: { id: string; displayName: string } }>;
  messages: Array<{ id: string; bodyRedacted: string | null; body: string | null; createdAt: string }>;
}

interface Props {
  onBack: () => void;
}

export function ChatListScreen({ onBack }: Props) {
  const { api, session, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const me = session?.userId ?? '';
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; conversations: Conversation[] }>('/api/conversations');
    if (r.success) setItems((r.data as { conversations: Conversation[] }).conversations);
  }, [api]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    const conv = items?.find((c) => c.id === openId);
    const other = conv?.participants.find((p) => p.userId !== me);
    return (
      <ChatScreen
        conversationId={openId}
        otherUserId={other?.userId ?? null}
        otherName={other?.user.displayName ?? null}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>
        <Text style={styles.h1}>{i18n.t(lang, 'nav.messages')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {items === null ? (
          <SkeletonList rows={4} />
        ) : items.length === 0 ? (
          <Text style={styles.muted}>{i18n.t(lang, 'chat.empty')}</Text>
        ) : (
          items.map((c) => {
            const other = c.participants.find((p) => p.userId !== me);
            const last = c.messages[0];
            return (
              <ConvRow
                key={c.id}
                title={other?.user.displayName ?? '—'}
                lastMessage={last?.bodyRedacted ?? last?.body ?? i18n.t(lang, 'chat.no_messages')}
                onPress={() => setOpenId(c.id)}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function ConvRow({
  title,
  lastMessage,
  onPress,
}: {
  title: string;
  lastMessage: string | null;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { scale, onPressIn, onPressOut } = usePressScale();
  const a = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        onPressIn();
        void haptic(motion.hapticToken.TAP_LIGHT);
      }}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.row, a]}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {lastMessage}
        </Text>
      </Animated.View>
    </Pressable>
  );
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
  muted: { ...t.type.caption, color: t.colors.textMuted, marginTop: t.spacing.xs },
  row: {
    backgroundColor: t.colors.surface,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  rowTitle: { ...t.type.title, color: t.colors.text },
}));

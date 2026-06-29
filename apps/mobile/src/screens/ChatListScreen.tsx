// Conversations list. Each conversation has the most-recent message preview embedded.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { ChatScreen } from './ChatScreen';

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
  const { api, session } = useAuth();
  const me = session?.userId ?? '';
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; conversations: Conversation[] }>('/api/conversations');
    if (r.success) setItems((r.data as { conversations: Conversation[] }).conversations);
  }, [api]);

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
        <Pressable onPress={onBack} hitSlop={16}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← Back</Text>
        </Pressable>
        <Text style={styles.h1}>Messages</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {items === null ? (
          <ActivityIndicator />
        ) : items.length === 0 ? (
          <Text style={styles.muted}>
            No conversations yet. After an employer accepts your application — or you accept
            a worker's — a chat opens automatically.
          </Text>
        ) : (
          items.map((c) => {
            const other = c.participants.find((p) => p.userId !== me);
            const last = c.messages[0];
            return (
              <ConvRow
                key={c.id}
                title={other?.user.displayName ?? 'Unknown'}
                lastMessage={last?.bodyRedacted ?? last?.body ?? null}
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
          {lastMessage ?? 'No messages yet'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  h1: { fontSize: 18, fontWeight: '700', color: motion.color.text },
  muted: { color: '#888', fontSize: 13, marginTop: 4 },
  row: {
    backgroundColor: motion.color.surface,
    padding: 16,
    borderRadius: motion.radius.md,
    marginBottom: 8,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: motion.color.text },
});

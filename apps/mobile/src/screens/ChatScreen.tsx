// Chat screen. v0 polls /messages every 4s; we'll swap to SSE/websockets later.
//
// UX choices:
//   - Composer is multiline; sends on tap of the send button (no Enter-to-send,
//     which collides with multiline editing on Android keyboards).
//   - When the server flags a message as redacted, we show a one-time soft warning
//     after the user's first redacted send, so they know the system stripped contact
//     info. Subsequent redacted sends just show the redacted bubble.
//   - Pashto-first labels; RTL handled by the parent layout direction.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';

interface Msg {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  flagged: boolean;
  createdAt: string;
}

interface Props {
  conversationId: string;
  onBack: () => void;
}

const POLL_MS = 4_000;

export function ChatScreen({ conversationId, onBack }: Props) {
  const { api, session } = useAuth();
  const me = session?.userId ?? '';

  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showedRedactedWarning, setShowedRedactedWarning] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; messages: Msg[] }>(
      `/api/conversations/${conversationId}/messages`,
    );
    if (r.success) setMessages((r.data as { messages: Msg[] }).messages);
  }, [api, conversationId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    void haptic(motion.hapticToken.TAP_LIGHT);

    const key = randomUUID();
    const r = await api.post<{ ok: true; value: { messageId: string; flagged: boolean } }>(
      `/api/conversations/${conversationId}/messages`,
      { body, idempotency_key: key },
      { idempotencyKey: key },
    );

    if (r.success) {
      const value = (r.data as { value: { flagged: boolean } }).value;
      setDraft('');
      if (value.flagged && !showedRedactedWarning) {
        setShowedRedactedWarning(true);
      }
      await load();
      void haptic(motion.hapticToken.SUCCESS);
    } else {
      void haptic(motion.hapticToken.ERROR);
      setError((r.data as { message?: string }).message ?? `send failed (${r.status})`);
    }
    setSending(false);
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const sendAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16}>
            <Text style={{ color: motion.color.primary, fontSize: 18 }}>← Back</Text>
          </Pressable>
          <Text style={styles.h1}>Chat</Text>
          <View style={{ width: 60 }} />
        </View>

        {showedRedactedWarning ? (
          <View style={styles.redactWarn}>
            <Text style={styles.redactWarnText}>
              KAFIL hides contact info in chat until a job is confirmed — this protects you
              and keeps disputes resolvable.
            </Text>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 6 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <Text style={styles.muted}>Say salaam to get started.</Text>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} isMe={m.senderId === me} />)
          )}
        </ScrollView>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            style={styles.input}
            multiline
            maxLength={4000}
          />
          <Pressable
            onPress={send}
            onPressIn={() => {
              onPressIn();
              void haptic(motion.hapticToken.TAP_LIGHT);
            }}
            onPressOut={onPressOut}
            disabled={!draft.trim() || sending}
          >
            <Animated.View
              style={[
                styles.sendBtn,
                (!draft.trim() || sending) && styles.sendBtnDisabled,
                sendAnim,
              ]}
            >
              {sending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.sendBtnText}>Send</Text>
              )}
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ msg, isMe }: { msg: Msg; isMe: boolean }) {
  // body is already redacted by the server before it reaches us (§5/§24/B1).
  return (
    <View
      style={[
        styles.bubble,
        isMe ? styles.bubbleMe : styles.bubbleThem,
        msg.flagged ? styles.bubbleFlagged : null,
      ]}
    >
      <Text style={[styles.bubbleText, isMe && { color: 'white' }]}>{msg.body}</Text>
    </View>
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
  redactWarn: {
    backgroundColor: '#fcefd9',
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: motion.radius.md,
    borderWidth: 1,
    borderColor: motion.color.warning,
  },
  redactWarnText: { color: motion.color.text, fontSize: 12 },
  muted: { color: '#888', textAlign: 'center', marginTop: 40 },
  bubble: {
    padding: 10,
    borderRadius: motion.radius.md,
    maxWidth: '78%',
    marginVertical: 2,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: motion.color.primary,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: motion.color.surface,
  },
  bubbleFlagged: { borderColor: motion.color.warning, borderWidth: 1 },
  bubbleText: { color: motion.color.text, fontSize: 15 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    backgroundColor: motion.color.surface,
    borderTopWidth: 1,
    borderTopColor: '#e0d8cc',
  },
  input: {
    flex: 1,
    backgroundColor: motion.color.bg,
    borderRadius: motion.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: motion.color.text,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: motion.color.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: motion.radius.pill,
  },
  sendBtnDisabled: { backgroundColor: '#bbb' },
  sendBtnText: { color: 'white', fontWeight: '700' },
  error: {
    color: motion.color.danger,
    textAlign: 'center',
    paddingVertical: 6,
  },
});

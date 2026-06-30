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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { useOutbox } from '../outbox/OutboxContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { ReportSheet } from '../components/ReportSheet';
import { makeStyles, useTheme } from '../theme';
import { useEventStream } from '../realtime/useEventStream';

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
  /** The other participant — enables report/block. Null only if not yet resolved. */
  otherUserId?: string | null;
  otherName?: string | null;
  onBack: () => void;
}

// SSE (useEventStream) is the fast path; this poll is a slow fallback for networks where
// the stream can't hold open. Was 4s when polling was the only mechanism (§P4.1).
const POLL_MS = 15_000;

/** A message bubble unified across server-confirmed and locally-queued messages. */
interface UiMsg {
  id: string;
  senderId: string;
  body: string | null;
  flagged: boolean;
  /** undefined = server-confirmed; otherwise the queued op's lifecycle. */
  pending?: 'queued' | 'sending' | 'failed';
  /** Present only on a failed bubble — re-queues the text under a fresh key. */
  onRetry?: () => void;
}

export function ChatScreen({ conversationId, otherUserId, onBack }: Props) {
  const { api, session, lang } = useAuth();
  const { enqueue, ops, online, prune } = useOutbox();
  const styles = useStyles();
  const { colors } = useTheme();
  const me = session?.userId ?? '';

  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [showedRedactedWarning, setShowedRedactedWarning] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; messages: Msg[] }>(
      `/api/conversations/${conversationId}/messages`,
    );
    if (r.success) setMessages((r.data as { messages: Msg[] }).messages);
  }, [api, conversationId]);

  // §P4.1 — real-time: the server pushes 'message.new' the instant the other party sends,
  // so we refetch immediately instead of waiting on a timer. The poll stays as a slow
  // fallback (SSE may not connect on every network), so chat still updates either way.
  useEventStream(
    {
      'message.new': (data) => {
        if (!data.conversationId || data.conversationId === conversationId) void load();
      },
    },
    true,
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Queued message ops for THIS conversation, oldest-first (send order).
  const myMsgOps = ops
    .filter((o) => o.kind === 'message' && (o.meta?.conversationId as string | undefined) === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt);

  /** The server messageId a done op created (from its captured response), if any. */
  const serverIdOf = (op: { response?: unknown }): string | undefined =>
    (op.response as { value?: { messageId?: string } } | undefined)?.value?.messageId;

  // Deterministic reconciliation: a 'done' op is only pruned once the polled list
  // actually contains the message it created (matched by the server messageId the op
  // captured). This avoids the flicker of pruning on a timer before the server copy
  // arrives — the optimistic bubble hands off to the real one with no gap.
  const polledIds = new Set(messages.map((m) => m.id));
  useEffect(() => {
    const landed = myMsgOps
      .filter((o) => o.status === 'done')
      .filter((o) => {
        const sid = serverIdOf(o);
        return sid != null && polledIds.has(sid);
      })
      .map((o) => o.id);
    if (landed.length) void prune(landed);
  }, [myMsgOps, polledIds, prune]);

  // Surface the redaction warning once, when any queued message comes back flagged.
  // (The server marks flagged on the polled copy; we also trust a done op's outcome.)
  useEffect(() => {
    if (showedRedactedWarning) return;
    if (messages.some((m) => m.flagged && m.senderId === me)) setShowedRedactedWarning(true);
  }, [messages, me, showedRedactedWarning]);

  // Merge server messages with optimistic bubbles. We show every op that isn't yet
  // represented in the polled list: pending/sending/failed always, and 'done' only
  // until its server copy lands (matched by captured messageId) — so there's never a
  // duplicate and never a gap.
  const unified: UiMsg[] = [
    ...messages.map((m) => ({ id: m.id, senderId: m.senderId, body: m.body, flagged: m.flagged })),
    ...myMsgOps
      .filter((o) => {
        if (o.status !== 'done') return true;
        const sid = serverIdOf(o);
        return !(sid != null && polledIds.has(sid)); // hide once the real copy arrived
      })
      .map((o) => ({
        id: o.id,
        senderId: me,
        body: (o.body as { body?: string }).body ?? '',
        flagged: false,
        // 'done' (sent, awaiting the polled copy) shows no indicator; otherwise
        // failed / sending / queued reflect the op's live state.
        pending: (o.status === 'done'
          ? undefined
          : o.status === 'failed'
            ? 'failed'
            : online
              ? 'sending'
              : 'queued') as UiMsg['pending'],
        onRetry: o.status === 'failed' ? () => void retryFailed(o) : undefined,
      })),
  ];

  useEffect(() => {
    // Scroll to bottom when the rendered count changes.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [unified.length]);

  // §13 — optimistic enqueue. A message shows immediately as a pending bubble and
  // sends in order when online; offline it simply waits. The op id is the idempotency
  // key the route dedupes on, so a flush re-send never double-posts.
  const enqueueMessage = useCallback(
    async (text: string) => {
      const key = randomUUID();
      await enqueue({
        method: 'POST',
        path: `/api/conversations/${conversationId}/messages`,
        body: { body: text, idempotency_key: key },
        kind: 'message',
        id: key,
        meta: { conversationId },
      });
      // Pull the server copy shortly after a successful online send so redaction +
      // ordering reconcile quickly (the poll also covers this on a 4s cadence).
      if (online) setTimeout(() => void load(), 400);
    },
    [enqueue, conversationId, online, load],
  );

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    void haptic(motion.hapticToken.TAP_LIGHT);
    await enqueueMessage(body);
    setDraft('');
  };

  // Retry a failed send: drop the dead op and re-queue its text under a fresh key.
  const retryFailed = useCallback(
    async (op: { id: string; body: unknown }) => {
      const text = (op.body as { body?: string }).body ?? '';
      await prune([op.id]);
      if (text) await enqueueMessage(text);
    },
    [prune, enqueueMessage],
  );

  const { scale, onPressIn, onPressOut } = usePressScale();
  const sendAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
          </Pressable>
          <Text style={styles.h1}>{i18n.t(lang, 'nav.chat')}</Text>
          {otherUserId ? (
            <Pressable onPress={() => setReportOpen(true)} hitSlop={16} accessibilityLabel={i18n.t(lang, 'safety.report')}>
              <Text style={{ color: colors.danger, fontSize: 22, width: 60, textAlign: 'right' }}>⚑</Text>
            </Pressable>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {showedRedactedWarning ? (
          <View style={styles.redactWarn}>
            <Text style={styles.redactWarnText}>
              KAFIL hides contact info in chat until a job is confirmed — this protects you
              and keeps disputes resolvable.
            </Text>
          </View>
        ) : null}

        {blocked ? (
          <View style={styles.blockedNotice}>
            <Text style={styles.blockedNoticeText}>{i18n.t(lang, 'safety.blocked_notice')}</Text>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 6 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {unified.length === 0 ? (
            <Text style={styles.muted}>{i18n.t(lang, 'chat.welcome')}</Text>
          ) : (
            unified.map((m) => <Bubble key={m.id} msg={m} isMe={m.senderId === me} lang={lang} />)
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={i18n.t(lang, 'common.message_placeholder')}
            style={styles.input}
            multiline
            maxLength={4000}
            editable={!blocked}
          />
          <Pressable
            onPress={send}
            onPressIn={() => {
              onPressIn();
              void haptic(motion.hapticToken.TAP_LIGHT);
            }}
            onPressOut={onPressOut}
            disabled={!draft.trim() || blocked}
            accessibilityLabel={i18n.t(lang, 'common.send')}
          >
            <Animated.View
              style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled, sendAnim]}
            >
              {/* §13 — send is optimistic: the queued bubble is the feedback, not a
                  blocking spinner. The button stays responsive even offline. */}
              <Text style={styles.sendBtnText}>{i18n.t(lang, 'common.send')}</Text>
            </Animated.View>
          </Pressable>
        </View>
      </View>

      {otherUserId ? (
        <ReportSheet
          visible={reportOpen}
          onClose={() => setReportOpen(false)}
          targetType="user"
          targetId={otherUserId}
          blockableUserId={otherUserId}
          onBlocked={() => setBlocked(true)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Bubble({
  msg,
  isMe,
  lang,
}: {
  msg: UiMsg;
  isMe: boolean;
  lang: import('@kafil/core').Lang;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  // body is already redacted by the server before it reaches us (§5/§24/B1).
  const failed = msg.pending === 'failed';
  return (
    <Pressable
      onPress={failed ? msg.onRetry : undefined}
      disabled={!failed}
      accessibilityLabel={failed ? i18n.t(lang, 'chat.send_failed') : undefined}
      style={[
        styles.bubble,
        isMe ? styles.bubbleMe : styles.bubbleThem,
        msg.flagged ? styles.bubbleFlagged : null,
        msg.pending && msg.pending !== 'failed' ? styles.bubblePending : null,
        failed ? styles.bubbleFailed : null,
      ]}
    >
      <Text style={[styles.bubbleText, isMe && { color: colors.textOnPrimary }]}>{msg.body}</Text>
      {msg.pending ? (
        <Text style={[styles.bubbleStatus, isMe && { color: colors.textOnPrimary }]}>
          {failed
            ? i18n.t(lang, 'chat.send_failed')
            : msg.pending === 'queued'
              ? `⏳ ${i18n.t(lang, 'offline.queued')}`
              : i18n.t(lang, 'chat.sending')}
        </Text>
      ) : null}
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
  redactWarn: {
    backgroundColor: t.colors.warningSoft,
    padding: t.spacing.sm,
    marginHorizontal: t.spacing.lg,
    marginBottom: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.warning,
  },
  redactWarnText: { ...t.type.caption, color: t.colors.text },
  blockedNotice: {
    backgroundColor: t.colors.dangerSoft,
    padding: t.spacing.sm,
    marginHorizontal: t.spacing.lg,
    marginBottom: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.danger,
  },
  blockedNoticeText: { ...t.type.caption, color: t.colors.danger, textAlign: 'center' },
  muted: { ...t.type.body, color: t.colors.textMuted, textAlign: 'center', marginTop: t.spacing.xxl },
  bubble: {
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    maxWidth: '78%',
    marginVertical: 2,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: t.colors.primary,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  bubbleFlagged: { borderColor: t.colors.warning, borderWidth: 1 },
  bubblePending: { opacity: 0.6 },
  bubbleFailed: { borderColor: t.colors.danger, borderWidth: 1 },
  bubbleText: { ...t.type.body, color: t.colors.text },
  bubbleStatus: { ...t.type.micro, marginTop: 3, color: t.colors.textFaint },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: t.spacing.sm,
    gap: t.spacing.sm,
    backgroundColor: t.colors.surface,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: t.colors.bg,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    fontSize: 15,
    color: t.colors.text,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: t.colors.primary,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: t.radius.pill,
  },
  sendBtnDisabled: { backgroundColor: t.colors.borderStrong },
  sendBtnText: { ...t.type.label, color: t.colors.textOnPrimary },
}));

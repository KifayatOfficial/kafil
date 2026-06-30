// §2.8 / v1.0 §4 — a single community group: its post feed (pinned-first), a composer
// for members, and inline comments. Members-only posting mirrors the server gate.
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
import { ReportSheet } from '../components/ReportSheet';
import { makeStyles, useTheme } from '../theme';

interface Author { id: string; displayName: string; photoUrl: string | null }
interface PostRow {
  id: string;
  kind: string;
  body: string | null;
  images: string[];
  pinned: boolean;
  commentCount: number;
  createdAt: string;
  author: Author;
}
interface CommentRow { id: string; body: string | null; createdAt: string; author: Author }

interface Props {
  groupId: string;
  groupName: string;
  joined: boolean;
  onBack: () => void;
}

export function GroupScreen({ groupId, groupName, joined: joinedInitial, onBack }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [joined, setJoined] = useState(joinedInitial);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; posts: PostRow[] }>(`/api/groups/${groupId}/posts`);
    if (r.success) setPosts((r.data as { posts: PostRow[] }).posts);
  }, [api, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  }, [load]);

  const join = async () => {
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(`/api/groups/${groupId}/join`, {}, { idempotencyKey: randomUUID() });
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setJoined(true);
    }
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(`/api/groups/${groupId}/posts`, { body }, { idempotencyKey: randomUUID() });
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setDraft('');
      await load();
    } else {
      void haptic(motion.hapticToken.ERROR);
    }
    setPosting(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
          </Pressable>
          <Text style={styles.h1} numberOfLines={1}>{groupName}</Text>
          <View style={{ width: 40 }} />
        </View>

        {posts && posts.length > 0 ? (
          // §P1.3b — virtualize the post feed (image-heavy, can grow long in active groups).
          <FlashList
            data={posts}
            keyExtractor={(p) => p.id}
            renderItem={({ item: p }) => (
              <PostCard
                post={p}
                lang={lang}
                api={api}
                expanded={openComments === p.id}
                onToggleComments={() => setOpenComments((cur) => (cur === p.id ? null : p.id))}
                onReport={() => setReport(p.id)}
                canComment={joined}
              />
            )}
            estimatedItemSize={140}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          >
            {posts === null ? (
              <SkeletonList rows={4} />
            ) : (
              <Text style={styles.muted}>{i18n.t(lang, 'community.posts_empty')}</Text>
            )}
          </ScrollView>
        )}

        {/* Composer (members) or a join prompt (non-members). */}
        {joined ? (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={i18n.t(lang, 'community.write_post')}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              multiline
              maxLength={4000}
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim() || posting}
              style={[styles.sendBtn, (!draft.trim() || posting) && styles.sendBtnDisabled]}
              accessibilityLabel={i18n.t(lang, 'community.post_cta')}
            >
              {posting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.sendBtnText}>{i18n.t(lang, 'community.post_cta')}</Text>}
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={join} style={styles.joinBar} accessibilityLabel={i18n.t(lang, 'community.join')}>
            <Text style={styles.joinBarText}>{i18n.t(lang, 'community.join_to_post')}</Text>
          </Pressable>
        )}
      </View>

      {report ? (
        <ReportSheet visible={!!report} onClose={() => setReport(null)} targetType="post" targetId={report} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PostCard({
  post, lang, api, expanded, onToggleComments, onReport, canComment,
}: {
  post: PostRow;
  lang: import('@kafil/core').Lang;
  api: import('@kafil/core').KafilApiClient;
  expanded: boolean;
  onToggleComments: () => void;
  onReport: () => void;
  canComment: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    (async () => {
      const r = await api.get<{ ok: true; comments: CommentRow[] }>(`/api/posts/${post.id}/comments`);
      if (!cancelled && r.success) setComments((r.data as { comments: CommentRow[] }).comments);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [expanded, api, post.id]);

  const sendComment = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    void haptic(motion.hapticToken.TAP_LIGHT);
    const r = await api.post(`/api/posts/${post.id}/comments`, { body }, { idempotencyKey: randomUUID() });
    if (r.success) {
      setDraft('');
      const cr = await api.get<{ ok: true; comments: CommentRow[] }>(`/api/posts/${post.id}/comments`);
      if (cr.success) setComments((cr.data as { comments: CommentRow[] }).comments);
    }
    setSending(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.author}>{post.author.displayName}</Text>
        {post.pinned ? <Text style={styles.pinned}>{i18n.t(lang, 'community.pinned')}</Text> : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onReport} hitSlop={10} accessibilityLabel={i18n.t(lang, 'safety.report')}>
          <Text style={{ color: colors.danger }}>⚑</Text>
        </Pressable>
      </View>
      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
      <Pressable onPress={onToggleComments} hitSlop={8}>
        <Text style={styles.commentToggle}>
          💬 {post.commentCount} {i18n.t(lang, 'community.comments')}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={styles.commentsWrap}>
          {comments === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            comments.map((c) => (
              <View key={c.id} style={styles.comment}>
                <Text style={styles.commentAuthor}>{c.author.displayName}</Text>
                <Text style={styles.commentBody}>{c.body}</Text>
              </View>
            ))
          )}
          {canComment ? (
            <View style={styles.commentComposer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={i18n.t(lang, 'community.write_comment')}
                placeholderTextColor={colors.textFaint}
                style={styles.commentInput}
                maxLength={1000}
              />
              <Pressable onPress={sendComment} disabled={!draft.trim() || sending} hitSlop={8}>
                <Text style={[styles.commentSend, (!draft.trim() || sending) && { opacity: 0.4 }]}>{i18n.t(lang, 'common.send')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  h1: { ...t.type.h2, color: t.colors.text, flex: 1, textAlign: 'center' },
  muted: { ...t.type.body, color: t.colors.textMuted, textAlign: 'center', marginTop: t.spacing.xl },
  card: { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.lg, marginBottom: t.spacing.md, ...t.elevation(1) },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  author: { ...t.type.label, color: t.colors.text },
  pinned: { ...t.type.micro, color: t.colors.accent },
  body: { ...t.type.body, color: t.colors.text, marginTop: t.spacing.sm },
  commentToggle: { ...t.type.caption, color: t.colors.primary, marginTop: t.spacing.md },
  commentsWrap: { marginTop: t.spacing.md, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.spacing.sm, gap: t.spacing.sm },
  comment: { backgroundColor: t.colors.bg, borderRadius: t.radius.md, padding: t.spacing.sm },
  commentAuthor: { ...t.type.micro, color: t.colors.textMuted },
  commentBody: { ...t.type.body, color: t.colors.text },
  commentComposer: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.xs },
  commentInput: { flex: 1, backgroundColor: t.colors.bg, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 10, paddingVertical: 8, color: t.colors.text },
  commentSend: { ...t.type.label, color: t.colors.primary },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: t.spacing.sm, gap: t.spacing.sm, backgroundColor: t.colors.surface, borderTopWidth: 1, borderTopColor: t.colors.border },
  input: { flex: 1, backgroundColor: t.colors.bg, borderRadius: t.radius.md, paddingHorizontal: 12, paddingVertical: 10, color: t.colors.text, maxHeight: 120 },
  sendBtn: { backgroundColor: t.colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: t.radius.pill, justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: t.colors.skeleton },
  sendBtnText: { ...t.type.label, color: t.colors.textOnPrimary },
  joinBar: { backgroundColor: t.colors.primary, padding: t.spacing.lg, alignItems: 'center' },
  joinBarText: { ...t.type.label, color: t.colors.textOnPrimary, fontSize: 16 },
}));

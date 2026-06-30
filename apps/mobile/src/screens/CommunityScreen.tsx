// §2.8 / v1.0 §4 — the community group directory. List + join groups, create a new
// one, and open a group's feed. KAFIL's "community" pillar entry point.
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
import { i18n, motion, randomUUID, type Lang } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';
import { GroupScreen } from './GroupScreen';
import { makeStyles, useTheme } from '../theme';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  memberCount: number;
  postCount: number;
  joined: boolean;
  location: { label: string; district: string | null } | null;
}

interface Props {
  onBack: () => void;
}

export function CommunityScreen({ onBack }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [open, setOpen] = useState<GroupRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; groups: GroupRow[] }>('/api/groups');
    if (r.success) setGroups((r.data as { groups: GroupRow[] }).groups);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  }, [load]);

  const join = async (g: GroupRow) => {
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(`/api/groups/${g.id}/join`, {}, { idempotencyKey: randomUUID() });
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      await load();
    }
  };

  const create = async () => {
    if (name.trim().length < 3 || busy) return;
    setBusy(true);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(
      '/api/groups',
      { name: name.trim(), description: desc.trim() || undefined, category: 'general' },
      { idempotencyKey: randomUUID() },
    );
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setName('');
      setDesc('');
      setCreating(false);
      await load();
    }
    setBusy(false);
  };

  if (open) {
    return (
      <GroupScreen
        groupId={open.id}
        groupName={open.name}
        joined={open.joined}
        onBack={() => {
          setOpen(null);
          void load();
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
          </Pressable>
          <Text style={styles.h1}>{i18n.t(lang, 'community.title')}</Text>
          <Pressable onPress={() => setCreating((c) => !c)} hitSlop={10} accessibilityLabel={i18n.t(lang, 'community.create')}>
            <Text style={{ color: colors.primary }}>{i18n.t(lang, 'community.create')}</Text>
          </Pressable>
        </View>

        {creating ? (
          <View style={styles.createCard}>
            <TextInput value={name} onChangeText={setName} placeholder={i18n.t(lang, 'community.name_ph')} placeholderTextColor={colors.textFaint} style={styles.input} maxLength={200} />
            <TextInput value={desc} onChangeText={setDesc} placeholder={i18n.t(lang, 'community.desc_ph')} placeholderTextColor={colors.textFaint} style={[styles.input, { marginTop: 8 }]} maxLength={500} />
            <Pressable onPress={create} disabled={name.trim().length < 3 || busy} style={[styles.createBtn, (name.trim().length < 3 || busy) && styles.createBtnDisabled]}>
              {busy ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.createBtnText}>{i18n.t(lang, 'community.create_title')}</Text>}
            </Pressable>
          </View>
        ) : null}

        {groups && groups.length > 0 ? (
          // §P1.3b — virtualize the group directory.
          <FlashList
            data={groups}
            keyExtractor={(g) => g.id}
            renderItem={({ item }) => (
              <GroupRowCard group={item} lang={lang} onOpen={() => setOpen(item)} onJoin={() => join(item)} />
            )}
            estimatedItemSize={92}
            contentContainerStyle={{ padding: 16 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          >
            {groups === null ? (
              <SkeletonList rows={4} />
            ) : (
              <Text style={styles.muted}>{i18n.t(lang, 'community.none')}</Text>
            )}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function GroupRowCard({
  group: g,
  lang,
  onOpen,
  onJoin,
}: {
  group: GroupRow;
  lang: Lang;
  onOpen: () => void;
  onJoin: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable onPress={onOpen} style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{g.name}</Text>
        {g.description ? <Text style={styles.desc} numberOfLines={1}>{g.description}</Text> : null}
        <Text style={styles.meta}>
          {g.memberCount} {i18n.t(lang, 'community.members')} · {g.postCount} 📝
          {g.location?.district ? ` · ${g.location.district}` : ''}
        </Text>
      </View>
      {g.joined ? (
        <View style={styles.joinedPill}><Text style={styles.joinedPillText}>{i18n.t(lang, 'community.joined')}</Text></View>
      ) : (
        <Pressable onPress={onJoin} style={styles.joinPill} accessibilityLabel={i18n.t(lang, 'community.join')}>
          <Text style={styles.joinPillText}>{i18n.t(lang, 'community.join')}</Text>
        </Pressable>
      )}
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
  name: { ...t.type.title, color: t.colors.text },
  desc: { ...t.type.caption, color: t.colors.textMuted, marginTop: 2 },
  meta: { ...t.type.micro, color: t.colors.textMuted, marginTop: t.spacing.xs },
  joinPill: { backgroundColor: t.colors.primary, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.lg, paddingVertical: 8 },
  joinPillText: { ...t.type.label, color: t.colors.textOnPrimary },
  joinedPill: { borderWidth: 1, borderColor: t.colors.primary, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.md, paddingVertical: 6 },
  joinedPillText: { ...t.type.micro, color: t.colors.primary },
}));

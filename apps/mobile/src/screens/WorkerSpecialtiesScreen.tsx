// Icon-first specialty picker (§25.1 + §12). Low-literacy users tap icons; no required
// typing on this screen. Multi-select, tap-to-toggle, then continue.
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';
import { VoicePromptButton, useVoicePrompt } from '../voice/VoicePromptButton';
import { makeStyles, useTheme } from '../theme';

interface SpecialtyRow {
  id: string;
  slug: string;
  name_ps?: string | null;
  name_ur?: string | null;
  name_en?: string | null;
  icon?: string | null;
}

interface Props {
  onDone: () => void;
}

// Map slug → emoji until designer icons land. The icons.* strings ride in the
// `specialties.icon` column for the prod swap.
const FALLBACK_ICON: Record<string, string> = {
  masonry: '🧱',
  electrician: '💡',
  carpenter: '🔨',
  plumber: '🚰',
  welder: '⚡',
};

export function WorkerSpecialtiesScreen({ onDone }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  useVoicePrompt('onboarding.specialties');
  const [items, setItems] = useState<SpecialtyRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; specialties: SpecialtyRow[] }>('/api/specialties');
      if (r.success) {
        const list = (r.data as { specialties: SpecialtyRow[] }).specialties;
        setItems(list);
      } else {
        setError('Failed to load specialties');
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed'));
  }, [api]);

  const toggle = (id: string) => {
    void haptic(motion.hapticToken.TAP_LIGHT);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.patch(
        '/api/worker-profile',
        { specialty_ids: Array.from(picked) },
        { idempotencyKey: randomUUID() },
      );
      if (!r.success) throw new Error((r.data as { message?: string }).message ?? 'save failed');
      void haptic(motion.hapticToken.SUCCESS);
      onDone();
    } catch (e: unknown) {
      void haptic(motion.hapticToken.ERROR);
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSaving(false);
    }
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const ctaAnimated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const grid = useMemo(() => items ?? [], [items]);

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{i18n.t(lang, 'onboarding.specialties_title')}</Text>
        <VoicePromptButton promptKey="onboarding.specialties" accessibilityLabel={i18n.t(lang, 'voice.replay')} />
      </View>
      <Text style={styles.subtitle}>{i18n.t(lang, 'common.tap_all')}</Text>

      {!items ? (
        <SkeletonList rows={4} />
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {grid.map((sp) => {
            const isPicked = picked.has(sp.id);
            const label = sp.name_ps ?? sp.name_en ?? sp.slug;
            const icon = (sp.icon && FALLBACK_ICON[sp.slug]) ?? FALLBACK_ICON[sp.slug] ?? '•';
            return (
              <Pressable
                key={sp.id}
                onPress={() => {
                  void haptic(motion.hapticToken.TAP_LIGHT);
                  toggle(sp.id);
                }}
                style={{ width: '33%' }}
                accessibilityLabel={label}
                accessibilityState={{ selected: isPicked }}
              >
                <View style={[styles.tile, isPicked && styles.tilePicked]}>
                  <Text style={{ fontSize: 38, marginBottom: 6 }}>{icon}</Text>
                  <Text style={[styles.tileLabel, isPicked && styles.tileLabelPicked]}>{label}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={submit}
        onPressIn={() => {
          onPressIn();
          void haptic(motion.hapticToken.TAP_LIGHT);
        }}
        onPressOut={onPressOut}
        disabled={picked.size === 0 || saving}
      >
        <Animated.View
          style={[
            styles.cta,
            (picked.size === 0 || saving) && styles.ctaDisabled,
            ctaAnimated,
          ]}
        >
          {saving ? <ActivityIndicator color={colors.textOnPrimary} /> : (
            <Text style={styles.ctaText}>
              {i18n.t(lang, 'common.continue')} {picked.size > 0 ? `(${picked.size})` : ''}
            </Text>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, padding: t.spacing.xl, paddingTop: 60 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: t.spacing.xs },
  title: { ...t.type.h2, color: t.colors.text, flexShrink: 1 },
  subtitle: { ...t.type.body, color: t.colors.textMuted, marginBottom: t.spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: t.spacing.xl },
  tile: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    margin: t.spacing.xs,
    paddingVertical: t.spacing.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  tilePicked: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
  tileLabel: { ...t.type.caption, fontWeight: '600', color: t.colors.text, textAlign: 'center' },
  tileLabelPicked: { color: t.colors.primary },
  cta: {
    backgroundColor: t.colors.primary,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xxl,
    borderRadius: t.radius.pill,
    marginTop: t.spacing.sm,
    minWidth: 220,
    alignSelf: 'center',
    alignItems: 'center',
    ...t.elevation(2),
  },
  ctaDisabled: { backgroundColor: t.colors.borderStrong, ...t.elevation(0) },
  ctaText: { ...t.type.label, color: t.colors.textOnPrimary, fontSize: 18 },
  error: { ...t.type.body, color: t.colors.danger, marginTop: t.spacing.sm, textAlign: 'center' },
}));

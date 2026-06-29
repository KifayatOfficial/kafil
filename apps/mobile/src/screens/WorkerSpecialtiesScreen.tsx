// Icon-first specialty picker (§25.1 + §12). Low-literacy users tap icons; no required
// typing on this screen. Multi-select, tap-to-toggle, then continue.
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';

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
      <Text style={styles.title}>{i18n.t(lang, 'onboarding.specialties_title')}</Text>
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
          {saving ? <ActivityIndicator color="white" /> : (
            <Text style={styles.ctaText}>
              {i18n.t(lang, 'common.continue')} {picked.size > 0 ? `(${picked.size})` : ''}
            </Text>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, padding: 24, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: '700', color: motion.color.text, marginBottom: 6 },
  subtitle: { color: '#888', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 24 },
  tile: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    margin: 4,
    paddingVertical: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tilePicked: { borderColor: motion.color.primary, backgroundColor: '#e8f1ec' },
  tileLabel: { fontSize: 13, fontWeight: '600', color: motion.color.text, textAlign: 'center' },
  tileLabelPicked: { color: motion.color.primary },
  cta: {
    backgroundColor: motion.color.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: motion.radius.pill,
    marginTop: 8,
    minWidth: 220,
    alignSelf: 'center',
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#bbb' },
  ctaText: { color: 'white', fontWeight: '700', fontSize: 18 },
  error: { color: motion.color.danger, marginTop: 8, textAlign: 'center' },
});

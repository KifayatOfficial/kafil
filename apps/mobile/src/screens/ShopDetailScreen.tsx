// §5 — a single shop: profile (name, description, categories, rating, location) +
// customer reviews + a star-rating review form. The shop directory's leaf screen.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';
import { ReportSheet } from '../components/ReportSheet';
import { makeStyles, useTheme } from '../theme';

interface ReviewRow { id: string; rating: number; comment: string | null; createdAt: string; author: { id: string; displayName: string } }
interface ShopDetail {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  verifiedTier: string;
  rating: number;
  reviewCount: number;
  owner: { id: string; displayName: string };
  location: { label: string; district: string | null } | null;
  reviews: ReviewRow[];
}

interface Props {
  shopId: string;
  onBack: () => void;
}

function Stars({ value }: { value: number }) {
  const styles = useStyles();
  const full = Math.round(value);
  return <Text style={styles.stars}>{'★'.repeat(full)}{'☆'.repeat(5 - full)}</Text>;
}

export function ShopDetailScreen({ shopId, onBack }: Props) {
  const { api, lang } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [myRating, setMyRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [report, setReport] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; shop: ShopDetail }>(`/api/shops/${shopId}`);
    if (r.success) setShop((r.data as { shop: ShopDetail }).shop);
  }, [api, shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitReview = async () => {
    if (myRating < 1 || submitting) return;
    setSubmitting(true);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const r = await api.post(
      `/api/shops/${shopId}/reviews`,
      { rating: myRating, comment: comment.trim() || undefined },
      { idempotencyKey: randomUUID() },
    );
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setDone(true);
      setComment('');
      setMyRating(0);
      await load();
    } else {
      void haptic(motion.hapticToken.ERROR);
    }
    setSubmitting(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
          </Pressable>
          <View style={{ width: 40 }} />
          <Pressable onPress={() => setReport(true)} hitSlop={10} accessibilityLabel={i18n.t(lang, 'safety.report')}>
            <Text style={{ color: colors.danger }}>⚑</Text>
          </Pressable>
        </View>

        {shop === null ? (
          <View style={{ padding: 16 }}><SkeletonList rows={4} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{shop.name}</Text>
              {shop.verifiedTier !== 'free' ? <Text style={styles.verified}>✓</Text> : null}
            </View>
            <View style={styles.ratingRow}>
              <Stars value={shop.rating} />
              <Text style={styles.muted}>{shop.rating.toFixed(1)} · {shop.reviewCount} {i18n.t(lang, 'shops.reviews')}</Text>
            </View>
            {shop.location?.district ? <Text style={styles.muted}>📍 {shop.location.label}, {shop.location.district}</Text> : null}
            {shop.categories.length ? (
              <View style={styles.catRow}>
                {shop.categories.map((c) => <View key={c} style={styles.catPill}><Text style={styles.catText}>{c}</Text></View>)}
              </View>
            ) : null}
            {shop.description ? <Text style={styles.desc}>{shop.description}</Text> : null}

            {/* Leave a review */}
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>{i18n.t(lang, 'shops.write_review')}</Text>
              <Text style={styles.muted}>{i18n.t(lang, 'shops.your_rating')}</Text>
              <View style={styles.starPicker}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => { void haptic(motion.hapticToken.TAP_LIGHT); setMyRating(n); }} hitSlop={6}>
                    <Text style={[styles.starPick, n <= myRating && styles.starPickOn]}>★</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder={i18n.t(lang, 'community.write_comment')}
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                maxLength={1000}
              />
              <Pressable
                onPress={submitReview}
                disabled={myRating < 1 || submitting}
                style={[styles.submitBtn, (myRating < 1 || submitting) && styles.submitBtnDisabled]}
              >
                {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.submitText}>{i18n.t(lang, 'shops.submit_review')}</Text>}
              </Pressable>
              {done ? <Text style={styles.doneNote}>{i18n.t(lang, 'shops.review_done')}</Text> : null}
            </View>

            {/* Reviews list */}
            <Text style={styles.sectionHead}>{i18n.t(lang, 'shops.reviews')}</Text>
            {shop.reviews.length === 0 ? (
              <Text style={styles.muted}>{i18n.t(lang, 'shops.no_reviews')}</Text>
            ) : (
              shop.reviews.map((r) => (
                <View key={r.id} style={styles.reviewRow}>
                  <View style={styles.reviewRowHead}>
                    <Text style={styles.reviewAuthor}>{r.author.displayName}</Text>
                    <Stars value={r.rating} />
                  </View>
                  {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>

      <ReportSheet visible={report} onClose={() => setReport(false)} targetType="shop" targetId={shopId} />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  name: { ...t.type.h1, color: t.colors.text },
  verified: { ...t.type.title, color: t.colors.primary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.xs },
  stars: { color: t.colors.accent, fontSize: 16 },
  muted: { ...t.type.caption, color: t.colors.textMuted, marginTop: t.spacing.xs },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs, marginTop: t.spacing.sm },
  catPill: { backgroundColor: t.colors.surface, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: t.spacing.md, paddingVertical: 4 },
  catText: { ...t.type.micro, color: t.colors.text },
  desc: { ...t.type.body, color: t.colors.text, marginTop: t.spacing.md },
  reviewCard: { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.lg, marginTop: t.spacing.xl },
  reviewTitle: { ...t.type.title, color: t.colors.text, marginBottom: t.spacing.xs },
  starPicker: { flexDirection: 'row', gap: t.spacing.xs, marginVertical: t.spacing.sm },
  starPick: { fontSize: 30, color: t.colors.border },
  starPickOn: { color: t.colors.accent },
  input: { backgroundColor: t.colors.bg, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12, paddingVertical: 10, color: t.colors.text, marginTop: t.spacing.xs },
  submitBtn: { backgroundColor: t.colors.primary, borderRadius: t.radius.pill, paddingVertical: 12, alignItems: 'center', marginTop: t.spacing.sm },
  submitBtnDisabled: { backgroundColor: t.colors.skeleton },
  submitText: { ...t.type.label, color: t.colors.textOnPrimary },
  doneNote: { ...t.type.caption, color: t.colors.primary, marginTop: t.spacing.sm, textAlign: 'center' },
  sectionHead: { ...t.type.title, color: t.colors.text, marginTop: t.spacing.xl, marginBottom: t.spacing.sm },
  reviewRow: { backgroundColor: t.colors.surface, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.md, marginBottom: t.spacing.sm },
  reviewRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewAuthor: { ...t.type.label, color: t.colors.text },
  reviewComment: { ...t.type.body, color: t.colors.text, marginTop: t.spacing.xs },
}));

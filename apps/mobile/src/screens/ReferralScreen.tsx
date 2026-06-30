// §10 F7 / §25.6 — referral screen. Shows the user's shareable code (native Share to
// WhatsApp etc.), their invite list with status + total earned, and — for a user who
// hasn't been referred yet — a one-time "enter a friend's code" claim.
//
// The reward is paid by the server only when the referred user completes their first
// job, so this screen never promises instant money; it shows pending → "Reward earned"
// as the server qualifies each invite.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { SkeletonList } from '../components/Skeleton';

interface ReferralRow {
  id: string;
  status: string;
  rewardMinor: number | null;
  createdAt: string;
}
interface Dashboard {
  code: string | null;
  referrals: ReferralRow[];
  totalRewardMinor: number;
  /** Whether the current user has already claimed someone's code (hides the claim box). */
  claimed?: boolean;
}

interface Props {
  onBack: () => void;
}

const pkr = (minor: number) => `${Math.round(minor / 100)} PKR`;

export function ReferralScreen({ onBack }: Props) {
  const { api, lang, deviceFingerprint } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimedNow, setClaimedNow] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true } & Dashboard>('/api/referrals');
    if (r.success) setData(r.data as Dashboard);
    else setError('Failed to load');
  }, [api]);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed'));
  }, [load]);

  const share = async () => {
    if (!data?.code) return;
    void haptic(motion.hapticToken.TAP_MEDIUM);
    try {
      await Share.share({ message: `${i18n.t(lang, 'referral.share_message')}${data.code}` });
    } catch {
      // user dismissed the share sheet — non-fatal
    }
  };

  const claim = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code || claiming) return;
    setClaiming(true);
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);
    const key = randomUUID();
    const r = await api.post(
      '/api/referrals/claim',
      { code, device_fingerprint: deviceFingerprint, idempotency_key: key },
      { idempotencyKey: key },
    );
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setClaimedNow(true);
      setCodeInput('');
    } else {
      void haptic(motion.hapticToken.ERROR);
      setError((r.data as { message?: string }).message ?? `claim failed (${r.status})`);
    }
    setClaiming(false);
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const shareAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const statusLabel = (s: string) =>
    s === 'qualified'
      ? i18n.t(lang, 'referral.status_qualified')
      : s === 'rejected_fraud'
        ? i18n.t(lang, 'referral.status_rejected')
        : i18n.t(lang, 'referral.status_pending');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16} accessibilityLabel={i18n.t(lang, 'common.back')}>
          <Text style={{ color: motion.color.primary, fontSize: 18 }}>← {i18n.t(lang, 'common.back')}</Text>
        </Pressable>
        <Text style={styles.h1}>{i18n.t(lang, 'referral.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {data === null ? (
        <View style={{ padding: 16 }}><SkeletonList rows={3} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={styles.subtitle}>{i18n.t(lang, 'referral.subtitle')}</Text>

          {/* The shareable code */}
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>{i18n.t(lang, 'referral.your_code')}</Text>
            <Text style={styles.code} accessibilityLabel={data.code ?? ''}>
              {data.code ?? '…'}
            </Text>
            <Pressable
              onPress={share}
              onPressIn={() => {
                onPressIn();
                void haptic(motion.hapticToken.TAP_LIGHT);
              }}
              onPressOut={onPressOut}
              disabled={!data.code}
            >
              <Animated.View style={[styles.shareBtn, shareAnim]}>
                <Text style={styles.shareBtnText}>📤 {i18n.t(lang, 'referral.share')}</Text>
              </Animated.View>
            </Pressable>
          </View>

          {/* Earned total */}
          {data.totalRewardMinor > 0 ? (
            <Text style={styles.earned}>
              {pkr(data.totalRewardMinor)} {i18n.t(lang, 'referral.earned')}
            </Text>
          ) : null}

          {/* Claim a code (only for users who haven't been referred and haven't just claimed) */}
          {!data.claimed && !claimedNow ? (
            <View style={styles.claimCard}>
              <Text style={styles.claimTitle}>{i18n.t(lang, 'referral.have_code')}</Text>
              <View style={styles.claimRow}>
                <TextInput
                  value={codeInput}
                  onChangeText={setCodeInput}
                  placeholder={i18n.t(lang, 'referral.enter_code')}
                  autoCapitalize="characters"
                  maxLength={16}
                  style={styles.claimInput}
                />
                <Pressable
                  onPress={claim}
                  disabled={!codeInput.trim() || claiming}
                  style={[styles.claimBtn, (!codeInput.trim() || claiming) && styles.claimBtnDisabled]}
                  accessibilityLabel={i18n.t(lang, 'referral.claim')}
                >
                  {claiming ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={styles.claimBtnText}>{i18n.t(lang, 'referral.claim')}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : claimedNow ? (
            <Text style={styles.claimedNotice}>✅ {i18n.t(lang, 'referral.claimed')}</Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* My referrals list */}
          <Text style={styles.listTitle}>{i18n.t(lang, 'referral.my_referrals')}</Text>
          {data.referrals.length === 0 ? (
            <Text style={styles.muted}>{i18n.t(lang, 'referral.none')}</Text>
          ) : (
            data.referrals.map((r) => (
              <View key={r.id} style={styles.refRow}>
                <Text style={styles.refStatus}>{statusLabel(r.status)}</Text>
                {r.status === 'qualified' && r.rewardMinor ? (
                  <Text style={styles.refReward}>+{pkr(r.rewardMinor)}</Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
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
  subtitle: { color: '#888', fontSize: 14, marginBottom: 16, lineHeight: 20 },
  codeCard: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: 20,
    alignItems: 'center',
  },
  codeLabel: { color: '#888', fontSize: 13 },
  code: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 4,
    color: motion.color.primary,
    marginVertical: 10,
  },
  shareBtn: {
    backgroundColor: motion.color.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: motion.radius.pill,
    marginTop: 4,
  },
  shareBtnText: { color: 'white', fontWeight: '700', fontSize: 16 },
  earned: {
    textAlign: 'center',
    color: motion.color.primary,
    fontWeight: '700',
    fontSize: 16,
    marginTop: 14,
  },
  claimCard: {
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: 16,
    marginTop: 20,
  },
  claimTitle: { color: motion.color.text, fontWeight: '600', marginBottom: 8 },
  claimRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  claimInput: {
    flex: 1,
    backgroundColor: motion.color.bg,
    borderRadius: motion.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    letterSpacing: 2,
    color: motion.color.text,
  },
  claimBtn: {
    backgroundColor: motion.color.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: motion.radius.pill,
    minWidth: 80,
    alignItems: 'center',
  },
  claimBtnDisabled: { backgroundColor: '#bbb' },
  claimBtnText: { color: 'white', fontWeight: '700' },
  claimedNotice: {
    textAlign: 'center',
    color: motion.color.primary,
    fontWeight: '600',
    marginTop: 20,
  },
  error: { color: motion.color.danger, marginTop: 12, textAlign: 'center' },
  listTitle: { fontSize: 16, fontWeight: '700', color: motion.color.text, marginTop: 28, marginBottom: 10 },
  muted: { color: '#888', fontSize: 14 },
  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: 14,
    marginBottom: 8,
  },
  refStatus: { color: motion.color.text, fontSize: 14 },
  refReward: { color: motion.color.primary, fontWeight: '700' },
});

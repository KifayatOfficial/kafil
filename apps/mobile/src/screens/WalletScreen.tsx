// Wallet / cash-out screen (§6). A worker sees their balance (earned via escrow
// releases) and withdraws to their phone wallet. Money is paisa on the wire; we show
// PKR. Success plays a class-D reward Lottie + success haptic.
//
// Guards surfaced inline (not just server errors): the §24/A1 SIM-swap cooldown
// disables withdraw with an explanation; a server FORBIDDEN for KYC<2 maps to a clear
// "verify your CNIC" message rather than a raw error.

import { useCallback, useEffect, useState } from 'react';
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
import { i18n, motion, randomUUID } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { usePressScale } from '../motion/animations';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

interface PayoutRow {
  id: string;
  amountMinor: string;
  status: string;
  createdAt: string;
}
interface Wallet {
  balanceMinor: string;
  currency: string;
  recentPayouts: PayoutRow[];
}

interface Props {
  onBack: () => void;
}

type Phase = 'loading' | 'ready' | 'submitting' | 'success' | 'error';

/** paisa (string) → human PKR, e.g. "800000" → "8,000". */
function pkr(minor: string): string {
  const n = Math.floor(Number(minor) / 100);
  return n.toLocaleString('en-US');
}

export function WalletScreen({ onBack }: Props) {
  const { api, inCooldown, lang: L } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [amountPkr, setAmountPkr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<{ ok: true; wallet: Wallet }>('/api/wallet');
    if (r.success) {
      setWallet((r.data as { wallet: Wallet }).wallet);
      setPhase((p) => (p === 'loading' ? 'ready' : p));
    } else {
      setError(i18n.t(L, 'error.generic'));
      setPhase('error');
    }
  }, [api, L]);

  useEffect(() => {
    load().catch(() => {
      setError(i18n.t(L, 'error.generic'));
      setPhase('error');
    });
  }, [load]);

  const balancePkr = wallet ? Math.floor(Number(wallet.balanceMinor) / 100) : 0;
  const enteredPkr = Number.parseInt(amountPkr, 10);
  const validAmount = Number.isFinite(enteredPkr) && enteredPkr >= 100 && enteredPkr <= balancePkr;

  const withdraw = async () => {
    if (!validAmount || phase === 'submitting' || inCooldown) return;
    setPhase('submitting');
    setError(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const key = randomUUID();
    const amountMinor = String(enteredPkr * 100);
    const r = await api.post<{ ok: true; value: { status: string } }>(
      '/api/payouts',
      { amount_minor: amountMinor, idempotency_key: key },
      { idempotencyKey: key },
    );

    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setPhase('success');
      setAmountPkr('');
      // Refresh balance behind the reward animation.
      setTimeout(() => {
        void load();
        setPhase('ready');
      }, 1800);
    } else {
      void haptic(motion.hapticToken.ERROR);
      const data = r.data as { code?: string; message?: string };
      // Map the KYC gate to a clear instruction instead of a raw 403 string.
      setError(
        data.code === 'FORBIDDEN' && data.message?.includes('KYC')
          ? i18n.t(L, 'wallet.kyc_required')
          : data.message ?? i18n.t(L, 'error.generic'),
      );
      setPhase('ready');
    }
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const ctaAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel="Back">
            <Text style={{ color: motion.color.primary, fontSize: 18 }}>← Back</Text>
          </Pressable>
          <Text style={styles.h1}>{i18n.t(L, 'wallet.title')}</Text>
          <View style={{ width: 60 }} />
        </View>

        {phase === 'loading' ? (
          <ActivityIndicator color={motion.color.primary} style={{ marginTop: 80 }} />
        ) : phase === 'success' ? (
          <View style={styles.successWrap}>
            <KafilLottie
              source={mascotIdle}
              motionClass={motion.MotionClass.D_REWARD}
              style={{ width: 160, height: 160 }}
            />
            <Text style={styles.successTitle}>{i18n.t(L, 'wallet.success_title')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>{i18n.t(L, 'wallet.balance')}</Text>
              <Text style={styles.balanceValue}>
                {wallet ? pkr(wallet.balanceMinor) : '—'}{' '}
                <Text style={styles.balanceCurrency}>{wallet?.currency ?? 'PKR'}</Text>
              </Text>
            </View>

            {inCooldown ? (
              <View style={styles.guardBanner}>
                <Text style={styles.guardText}>🔒 {i18n.t(L, 'wallet.cooldown')}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>{i18n.t(L, 'wallet.amount')}</Text>
            <View style={styles.amountRow}>
              <TextInput
                value={amountPkr}
                onChangeText={(v) => setAmountPkr(v.replace(/[^0-9]/g, ''))}
                placeholder="0"
                keyboardType="number-pad"
                style={styles.amountInput}
                maxLength={7}
                editable={!inCooldown}
              />
              <Pressable
                onPress={() => setAmountPkr(String(balancePkr))}
                style={styles.maxBtn}
                disabled={inCooldown || balancePkr < 100}
              >
                <Text style={styles.maxBtnText}>{i18n.t(L, 'wallet.withdraw_all')}</Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={withdraw}
              onPressIn={() => {
                onPressIn();
                void haptic(motion.hapticToken.TAP_LIGHT);
              }}
              onPressOut={onPressOut}
              disabled={!validAmount || phase === 'submitting' || inCooldown}
              accessibilityLabel={i18n.t(L, 'wallet.withdraw')}
            >
              <Animated.View
                style={[styles.cta, (!validAmount || phase === 'submitting' || inCooldown) && styles.ctaDisabled, ctaAnim]}
              >
                {phase === 'submitting' ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.ctaText}>{i18n.t(L, 'wallet.withdraw')}</Text>
                )}
              </Animated.View>
            </Pressable>

            <Text style={styles.recentHead}>{i18n.t(L, 'wallet.recent')}</Text>
            {wallet && wallet.recentPayouts.length > 0 ? (
              wallet.recentPayouts.map((p) => (
                <View key={p.id} style={styles.payoutRow}>
                  <Text style={styles.payoutAmount}>{pkr(p.amountMinor)} PKR</Text>
                  <View style={styles.payoutMeta}>
                    <StatusBadge status={p.status} lang={L} />
                    <Text style={styles.payoutDate}>{new Date(p.createdAt).toLocaleDateString()}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>{i18n.t(L, 'wallet.none')}</Text>
            )}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// §25.2 — never colour alone: pair the dot with a text label.
function StatusBadge({ status, lang }: { status: string; lang: import('@kafil/core').Lang }) {
  const color =
    status === 'sent' ? motion.color.primary : status === 'failed' ? motion.color.danger : motion.color.warning;
  const label = status === 'sent' ? i18n.t(lang, 'wallet.sent') : status;
  return (
    <View style={styles.badge}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motion.color.bg, paddingHorizontal: 16, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: motion.spacing.md,
  },
  h1: { fontSize: 18, fontWeight: '700', color: motion.color.text },
  balanceCard: {
    backgroundColor: motion.color.primary,
    borderRadius: motion.radius.lg,
    padding: motion.spacing.xl,
    alignItems: 'center',
    marginTop: motion.spacing.sm,
  },
  balanceLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  balanceValue: { color: 'white', fontSize: 40, fontWeight: '800', marginTop: 4 },
  balanceCurrency: { fontSize: 18, fontWeight: '600' },
  guardBanner: {
    backgroundColor: '#fcefd9',
    padding: motion.spacing.md,
    borderRadius: motion.radius.md,
    borderWidth: 1,
    borderColor: motion.color.warning,
    marginTop: motion.spacing.lg,
  },
  guardText: { color: motion.color.text, fontSize: 13 },
  label: { fontSize: 14, fontWeight: '600', color: motion.color.text, marginTop: motion.spacing.xl, marginBottom: 6 },
  amountRow: { flexDirection: 'row', gap: motion.spacing.sm, alignItems: 'center' },
  amountInput: {
    flex: 1,
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '700',
    color: motion.color.text,
  },
  maxBtn: {
    paddingHorizontal: motion.spacing.lg,
    paddingVertical: 14,
    borderRadius: motion.radius.md,
    borderWidth: 1,
    borderColor: motion.color.primary,
  },
  maxBtnText: { color: motion.color.primary, fontWeight: '700' },
  cta: {
    backgroundColor: motion.color.primary,
    paddingVertical: 16,
    borderRadius: motion.radius.pill,
    alignItems: 'center',
    marginTop: motion.spacing.lg,
  },
  ctaDisabled: { backgroundColor: '#bbb' },
  ctaText: { color: 'white', fontWeight: '700', fontSize: 16 },
  recentHead: { fontSize: 14, fontWeight: '700', color: motion.color.text, marginTop: motion.spacing.xxl, marginBottom: motion.spacing.sm },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    padding: motion.spacing.md,
    marginBottom: motion.spacing.sm,
  },
  payoutAmount: { fontSize: 15, fontWeight: '700', color: motion.color.text },
  payoutMeta: { alignItems: 'flex-end', gap: 2 },
  payoutDate: { fontSize: 11, color: '#888' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  muted: { color: '#888', fontSize: 13, marginTop: 4 },
  error: { color: motion.color.danger, marginTop: motion.spacing.md, textAlign: 'center' },
  successWrap: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: motion.spacing.md },
  successTitle: { fontSize: 22, fontWeight: '800', color: motion.color.primary },
});

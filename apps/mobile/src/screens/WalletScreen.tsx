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
import { makeStyles, useTheme } from '../theme';
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
  const styles = useStyles();
  const { colors } = useTheme();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [amountPkr, setAmountPkr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [topUpPkr, setTopUpPkr] = useState('');
  const [toppingUp, setToppingUp] = useState(false);
  const [topUpNote, setTopUpNote] = useState<string | null>(null);

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

  // §6 — top up the wallet. Initiate a pending Payment, then (dev) confirm it so the
  // balance updates immediately. In production the confirm is the signed PSP webhook;
  // the dev-confirm route is hard-disabled there, so this gracefully shows "pending".
  const topUpEnteredPkr = Number.parseInt(topUpPkr, 10);
  const validTopUp = Number.isFinite(topUpEnteredPkr) && topUpEnteredPkr >= 50;
  const topUp = async () => {
    if (!validTopUp || toppingUp || inCooldown) return;
    setToppingUp(true);
    setError(null);
    setTopUpNote(null);
    void haptic(motion.hapticToken.TAP_MEDIUM);

    const key = randomUUID();
    const amountMinor = String(topUpEnteredPkr * 100);
    const init = await api.post<{ ok: true; value: { paymentId: string } }>(
      '/api/wallet/topup',
      { amount_minor: amountMinor, idempotency_key: key },
      { idempotencyKey: key },
    );
    if (!init.success) {
      void haptic(motion.hapticToken.ERROR);
      setError((init.data as { message?: string }).message ?? i18n.t(L, 'error.generic'));
      setToppingUp(false);
      return;
    }
    const paymentId = (init.data as { value: { paymentId: string } }).value.paymentId;

    // Dev confirm (PSP simulation). If unavailable (prod), surface a pending note.
    const confirm = await api.post('/api/wallet/topup/confirm', { payment_id: paymentId });
    if (confirm.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setTopUpPkr('');
      setTopUpNote(i18n.t(L, 'wallet.topup_success'));
      await load();
    } else {
      setTopUpNote(i18n.t(L, 'wallet.topup_pending'));
    }
    setToppingUp(false);
  };

  const { scale, onPressIn, onPressOut } = usePressScale();
  const ctaAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={16} accessibilityLabel="Back">
            <Text style={{ color: colors.primary, fontSize: 18 }}>← Back</Text>
          </Pressable>
          <Text style={styles.h1}>{i18n.t(L, 'wallet.title')}</Text>
          <View style={{ width: 60 }} />
        </View>

        {phase === 'loading' ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
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

            {/* §6 — TOP UP. Add money to spend on featured posts / escrow funding. */}
            <Text style={styles.label}>{i18n.t(L, 'wallet.topup_amount')}</Text>
            <View style={styles.chipRow}>
              {[200, 500, 1000].map((amt) => (
                <Pressable
                  key={amt}
                  onPress={() => {
                    void haptic(motion.hapticToken.TAP_LIGHT);
                    setTopUpPkr(String(amt));
                  }}
                  style={[styles.chip, topUpPkr === String(amt) && styles.chipActive]}
                  disabled={inCooldown}
                  accessibilityLabel={`${amt} PKR`}
                >
                  <Text style={[styles.chipText, topUpPkr === String(amt) && styles.chipTextActive]}>{amt}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.amountRow}>
              <TextInput
                value={topUpPkr}
                onChangeText={(v) => setTopUpPkr(v.replace(/[^0-9]/g, ''))}
                placeholder="0"
                keyboardType="number-pad"
                style={styles.amountInput}
                maxLength={7}
                editable={!inCooldown}
              />
              <Pressable
                onPress={topUp}
                disabled={!validTopUp || toppingUp || inCooldown}
                style={[styles.topUpBtn, (!validTopUp || toppingUp || inCooldown) && styles.ctaDisabled]}
                accessibilityLabel={i18n.t(L, 'wallet.topup_cta')}
              >
                {toppingUp ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.topUpBtnText}>{i18n.t(L, 'wallet.topup_cta')}</Text>
                )}
              </Pressable>
            </View>
            {topUpNote ? <Text style={styles.topUpNote}>{topUpNote}</Text> : null}

            <View style={styles.divider} />

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
                  <ActivityIndicator color={colors.textOnPrimary} />
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
  const styles = useStyles();
  const { colors } = useTheme();
  const color =
    status === 'sent' ? colors.primary : status === 'failed' ? colors.danger : colors.warning;
  const label = status === 'sent' ? i18n.t(lang, 'wallet.sent') : status;
  return (
    <View style={styles.badge}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg, paddingHorizontal: t.spacing.lg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: t.spacing.md,
  },
  h1: { ...t.type.h2, color: t.colors.text },
  balanceCard: {
    backgroundColor: t.colors.primarySoft,
    borderRadius: t.radius.lg,
    padding: t.spacing.xl,
    alignItems: 'center',
    marginTop: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(2),
  },
  balanceLabel: { ...t.type.caption, color: t.colors.textMuted },
  balanceValue: { color: t.colors.primary, fontSize: 40, fontWeight: '800', marginTop: t.spacing.xs },
  balanceCurrency: { fontSize: 18, fontWeight: '600' },
  guardBanner: {
    backgroundColor: t.colors.warningSoft,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.warning,
    marginTop: t.spacing.lg,
  },
  guardText: { ...t.type.caption, color: t.colors.text },
  label: { ...t.type.label, color: t.colors.text, marginTop: t.spacing.xl, marginBottom: 6 },
  amountRow: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' },
  amountInput: {
    flex: 1,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '700',
    color: t.colors.text,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  maxBtn: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: 14,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.primary,
  },
  maxBtnText: { color: t.colors.primary, fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.sm },
  chip: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  chipActive: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
  chipText: { ...t.type.label, color: t.colors.text },
  chipTextActive: { color: t.colors.primary },
  topUpBtn: {
    backgroundColor: t.colors.primary,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: 14,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  topUpBtnText: { color: t.colors.textOnPrimary, fontWeight: '700' },
  topUpNote: { ...t.type.caption, color: t.colors.primary, marginTop: t.spacing.sm },
  divider: { height: 1, backgroundColor: t.colors.border, marginVertical: t.spacing.xl },
  cta: {
    backgroundColor: t.colors.primary,
    paddingVertical: t.spacing.lg,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    marginTop: t.spacing.lg,
  },
  ctaDisabled: { backgroundColor: t.colors.skeleton },
  ctaText: { ...t.type.title, color: t.colors.textOnPrimary, fontWeight: '700' },
  recentHead: { ...t.type.label, fontWeight: '700', color: t.colors.text, marginTop: t.spacing.xxl, marginBottom: t.spacing.sm },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.md,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  payoutAmount: { ...t.type.body, fontWeight: '700', color: t.colors.text },
  payoutMeta: { alignItems: 'flex-end', gap: 2 },
  payoutDate: { ...t.type.micro, fontWeight: '400', color: t.colors.textFaint },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { ...t.type.micro },
  muted: { ...t.type.caption, color: t.colors.textMuted, marginTop: t.spacing.xs },
  error: { color: t.colors.danger, marginTop: t.spacing.md, textAlign: 'center' },
  successWrap: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: t.spacing.md },
  successTitle: { ...t.type.h1, color: t.colors.primary },
}));

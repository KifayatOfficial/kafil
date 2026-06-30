// ReportSheet — the user-facing half of Trust & Safety (§9/§10, P7).
//
// Icon-first per §12 (low-literacy): each reason is a big emoji glyph + a short
// trilingual label, so a one-tap report needs no reading fluency. Posts to
// /api/reports (the backend resolves the offender + raises a weighted fraud signal).
//
// Works for any target (user / job / message). For `user` targets it also offers a
// Block action (§25.9 / F11) — reporting and blocking are separate intents, both
// surfaced here so the flow is one sheet, not two.

import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { i18n, motion, randomUUID, type ReportReason, type ReportTargetType } from '@kafil/core';
import type { Lang } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';
import { makeStyles, useTheme } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  /** Pashto by default; threaded from the signed-in user's preferred language later. */
  lang?: Lang;
  /** For user targets: offer Block, and report success after a block. */
  blockableUserId?: string;
  /** Called after a successful block so the parent can close the channel UI. */
  onBlocked?: () => void;
}

const REASONS: Array<{ reason: ReportReason; glyph: string; key: i18n.StringKey }> = [
  { reason: 'scam', glyph: '⚠️', key: 'safety.reason_scam' },
  { reason: 'fee_request', glyph: '💸', key: 'safety.reason_fee' },
  { reason: 'fake', glyph: '🎭', key: 'safety.reason_fake' },
  { reason: 'off_platform', glyph: '📵', key: 'safety.reason_offplatform' },
  { reason: 'harassment', glyph: '🚫', key: 'safety.reason_harassment' },
  { reason: 'spam', glyph: '📨', key: 'safety.reason_spam' },
  { reason: 'other', glyph: '❓', key: 'safety.reason_other' },
];

type Phase = 'choosing' | 'submitting' | 'done' | 'error';

export function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
  lang = 'ps',
  blockableUserId,
  onBlocked,
}: Props) {
  const { api } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>('choosing');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase('choosing');
    setError(null);
  };

  const submit = async (reason: ReportReason) => {
    if (phase === 'submitting') return;
    setPhase('submitting');
    setError(null);
    void haptic(motion.hapticToken.TAP_LIGHT);
    const key = randomUUID();
    const r = await api.post(
      '/api/reports',
      { target_type: targetType, target_id: targetId, reason, idempotency_key: key },
      { idempotencyKey: key },
    );
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      setPhase('done');
    } else {
      void haptic(motion.hapticToken.ERROR);
      setError((r.data as { message?: string }).message ?? i18n.t(lang, 'error.generic'));
      setPhase('error');
    }
  };

  const block = async () => {
    if (!blockableUserId || phase === 'submitting') return;
    setPhase('submitting');
    setError(null);
    const key = randomUUID();
    const r = await api.post(
      `/api/users/${blockableUserId}/block`,
      { reason: 'reported_from_app', idempotency_key: key },
      { idempotencyKey: key },
    );
    if (r.success) {
      void haptic(motion.hapticToken.SUCCESS);
      onBlocked?.();
      onClose();
      reset();
    } else {
      void haptic(motion.hapticToken.ERROR);
      setError((r.data as { message?: string }).message ?? i18n.t(lang, 'error.generic'));
      setPhase('error');
    }
  };

  const close = () => {
    onClose();
    // Defer reset so the closing animation doesn't flash the chooser.
    setTimeout(reset, 200);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        {/* Inner press is swallowed so tapping the sheet doesn't close it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {phase === 'done' ? (
            <View style={styles.doneWrap}>
              <Text style={styles.doneGlyph}>✅</Text>
              <Text style={styles.h1}>{i18n.t(lang, 'safety.submitted')}</Text>
              <Text style={styles.body}>{i18n.t(lang, 'safety.submitted_body')}</Text>
              <Pressable style={styles.primaryBtn} onPress={close}>
                <Text style={styles.primaryBtnText}>{i18n.t(lang, 'common.continue')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.h1}>
                {targetType === 'job'
                  ? i18n.t(lang, 'safety.report_job')
                  : i18n.t(lang, 'safety.report_user')}
              </Text>
              <Text style={styles.body}>{i18n.t(lang, 'safety.report_title')}</Text>

              <View style={styles.grid}>
                {REASONS.map((r) => (
                  <Pressable
                    key={r.reason}
                    style={styles.reasonTile}
                    onPress={() => void submit(r.reason)}
                    disabled={phase === 'submitting'}
                  >
                    <Text style={styles.reasonGlyph}>{r.glyph}</Text>
                    <Text style={styles.reasonLabel}>{i18n.t(lang, r.key)}</Text>
                  </Pressable>
                ))}
              </View>

              {phase === 'submitting' ? <ActivityIndicator color={colors.primary} /> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}

              {blockableUserId ? (
                <Pressable
                  style={styles.blockBtn}
                  onPress={() => void block()}
                  disabled={phase === 'submitting'}
                >
                  <Text style={styles.blockBtnText}>🚫 {i18n.t(lang, 'safety.block_user')}</Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.cancelBtn} onPress={close}>
                <Text style={styles.cancelBtnText}>{i18n.t(lang, 'common.cancel')}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: { flex: 1, backgroundColor: t.colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.colors.bgElevated,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    padding: t.spacing.lg,
    paddingBottom: t.spacing.xxl,
    ...t.elevation(3),
  },
  h1: { ...t.type.h2, color: t.colors.text, textAlign: 'center' },
  body: { ...t.type.body, color: t.colors.textMuted, textAlign: 'center', marginTop: t.spacing.xs, marginBottom: t.spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.spacing.sm },
  reasonTile: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation(1),
  },
  reasonGlyph: { fontSize: 32 },
  reasonLabel: { ...t.type.caption, color: t.colors.text, textAlign: 'center', marginTop: t.spacing.xs },
  blockBtn: {
    marginTop: t.spacing.lg,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.danger,
    alignItems: 'center',
  },
  blockBtnText: { ...t.type.label, color: t.colors.danger },
  cancelBtn: { marginTop: t.spacing.md, padding: t.spacing.md, alignItems: 'center' },
  cancelBtnText: { ...t.type.label, color: t.colors.textMuted },
  error: { ...t.type.body, color: t.colors.danger, textAlign: 'center', marginTop: t.spacing.sm },
  doneWrap: { alignItems: 'center', paddingVertical: t.spacing.lg },
  doneGlyph: { fontSize: 48 },
  primaryBtn: {
    marginTop: t.spacing.lg,
    backgroundColor: t.colors.primary,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.pill,
  },
  primaryBtnText: { ...t.type.label, color: t.colors.textOnPrimary },
}));

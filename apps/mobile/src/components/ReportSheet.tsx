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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { i18n, motion, randomUUID, type ReportReason, type ReportTargetType } from '@kafil/core';
import type { Lang } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../motion/feedback';

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

              {phase === 'submitting' ? <ActivityIndicator color={motion.color.primary} /> : null}
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: motion.color.bg,
    borderTopLeftRadius: motion.radius.lg,
    borderTopRightRadius: motion.radius.lg,
    padding: motion.spacing.lg,
    paddingBottom: motion.spacing.xxl,
  },
  h1: { fontSize: 20, fontWeight: '700', color: motion.color.text, textAlign: 'center' },
  body: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 4, marginBottom: motion.spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: motion.spacing.sm },
  reasonTile: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: motion.color.surface,
    borderRadius: motion.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: motion.spacing.sm,
    borderWidth: 1,
    borderColor: '#eee',
  },
  reasonGlyph: { fontSize: 32 },
  reasonLabel: { fontSize: 12, color: motion.color.text, textAlign: 'center', marginTop: 6 },
  blockBtn: {
    marginTop: motion.spacing.lg,
    padding: motion.spacing.md,
    borderRadius: motion.radius.md,
    borderWidth: 1,
    borderColor: motion.color.danger,
    alignItems: 'center',
  },
  blockBtnText: { color: motion.color.danger, fontWeight: '700', fontSize: 15 },
  cancelBtn: { marginTop: motion.spacing.md, padding: motion.spacing.md, alignItems: 'center' },
  cancelBtnText: { color: '#888', fontSize: 15 },
  error: { color: motion.color.danger, textAlign: 'center', marginTop: motion.spacing.sm },
  doneWrap: { alignItems: 'center', paddingVertical: motion.spacing.lg },
  doneGlyph: { fontSize: 48 },
  primaryBtn: {
    marginTop: motion.spacing.lg,
    backgroundColor: motion.color.primary,
    paddingHorizontal: motion.spacing.xl,
    paddingVertical: motion.spacing.md,
    borderRadius: motion.radius.pill,
  },
  primaryBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },
});

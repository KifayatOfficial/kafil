// §13 / §25.4 — the global sync status pill. On a 2G/3G network, the single biggest
// trust signal is "did my action save?". This is the one persistent place that answers
// it app-wide, reading the same outbox the apply/accept/message flows enqueue into.
//
// States (priority order):
//   failed   — one or more queued mutations gave up (4xx/exhausted). Tappable hint.
//   offline  — no connectivity; queued work is waiting (not an error — "saved, will send").
//   syncing  — online with in-flight/pending ops; shows the count.
//   synced   — pending just drained to zero: a brief confirmation flash, then hides.
//   (hidden) — nothing queued and no recent activity: the pill renders nothing.
//
// Deliberately tiny and non-blocking: it never covers content, never spins a modal.

import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { i18n } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { useOutbox } from '../outbox/OutboxContext';
import { makeStyles, useTheme } from '../theme';

const SYNCED_FLASH_MS = 2_000;

export function SyncIndicator() {
  const { lang } = useAuth();
  const { ops, pending, online } = useOutbox();
  const styles = useStyles();
  const { colors } = useTheme();

  const failedCount = ops.filter((o) => o.status === 'failed').length;
  const pendingCount = pending.length;

  // Briefly flash "Saved" when pending transitions from >0 to 0 (a sync just finished).
  const [showSynced, setShowSynced] = useState(false);
  const prevPending = useRef(pendingCount);
  useEffect(() => {
    if (prevPending.current > 0 && pendingCount === 0 && failedCount === 0) {
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), SYNCED_FLASH_MS);
      prevPending.current = pendingCount;
      return () => clearTimeout(t);
    }
    prevPending.current = pendingCount;
  }, [pendingCount, failedCount]);

  // Resolve the active state.
  let kind: 'failed' | 'offline' | 'syncing' | 'synced' | null = null;
  if (failedCount > 0) kind = 'failed';
  else if (!online && pendingCount > 0) kind = 'offline';
  else if (pendingCount > 0) kind = 'syncing';
  else if (showSynced) kind = 'synced';

  if (!kind) return null;

  const tone =
    kind === 'failed' ? colors.danger : kind === 'synced' ? colors.primary : colors.textMuted;
  const label =
    kind === 'failed'
      ? `${failedCount} · ${i18n.t(lang, 'sync.failed')}`
      : kind === 'offline'
        ? `${i18n.t(lang, 'sync.offline')} · ${pendingCount}`
        : kind === 'syncing'
          ? `${i18n.t(lang, 'sync.syncing')} ${pendingCount}…`
          : i18n.t(lang, 'sync.synced');
  const icon = kind === 'failed' ? '⚠' : kind === 'offline' ? '⚡' : kind === 'synced' ? '✓' : '⏳';

  // Only the failed state is interactive (tapping it is a hint to open the relevant
  // screen and retry — the per-item retry lives on the bubbles/cards themselves).
  const body = (
    <View style={[styles.pill, { borderColor: tone }]}>
      <Text style={[styles.text, { color: tone }]} numberOfLines={1}>
        {icon} {label}
      </Text>
    </View>
  );

  if (kind === 'failed') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
        {body}
      </Pressable>
    );
  }
  return <View accessibilityLabel={label}>{body}</View>;
}

const useStyles = makeStyles((t) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.md,
    paddingVertical: 4,
  },
  text: { ...t.type.micro },
}));

// §25.4 — STATEFULVIEW: one place that turns "data screen" into the four states every
// data screen needs, so none of them is ever a blank page, a bare spinner, or a raw
// error string. Generalizes the friendly EmptyJobs pattern (HomeScreen) into a reusable
// surface and adds the error + offline states screens currently handle ad-hoc.
//
//   loading  — content-shaped skeletons (never a lonely spinner)
//   error    — mascot + spoken-friendly message + a big Retry; distinguishes a network
//              outage ("you're offline, we'll retry") from a server fault ("something
//              went wrong"), because the user's mental model and next action differ
//   empty    — mascot + encouragement + optional tips + a primary next action (an empty
//              feed is an on-ramp, not a dead end)
//   ready    — render the children
//
// Usage:
//   <StatefulView
//     status={data === null ? (error ? 'error' : 'loading') : 'ready'}
//     error={error}
//     onRetry={reload}
//     empty={data?.length === 0}
//     emptyTitle={t('empty.no_jobs')}
//     emptyHint={t('empty.jobs_hint')}
//     emptyAction={{ label: t('nav.post_job'), onPress: openPost }}
//     skeleton={<SkeletonList rows={5} />}
//   >
//     {rows}
//   </StatefulView>

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { i18n, motion } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';
import { useOutbox } from '../outbox/OutboxContext';
import { haptic } from '../motion/feedback';
import { KafilLottie } from '../motion/KafilLottie';
import { makeStyles, useTheme } from '../theme';
import { SkeletonList } from './Skeleton';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mascotIdle = require('../../assets/lottie/mascot_idle.json');

export type ViewStatus = 'loading' | 'error' | 'ready';

interface Action {
  label: string;
  onPress: () => void;
}

interface Props {
  status: ViewStatus;
  /** When status==='ready' and this is true, render the empty state instead of children. */
  empty?: boolean;
  children: ReactNode;

  /** Loading: a content-shaped skeleton. Defaults to a 5-row card skeleton. */
  skeleton?: ReactNode;

  /** Error: message + retry. Offline is auto-detected from the outbox connectivity. */
  error?: string | null;
  onRetry?: () => void;

  /** Empty: friendly copy + optional tips + primary action. */
  emptyTitle?: string;
  emptyHint?: string;
  emptyTips?: string[];
  emptyAction?: Action;
}

export function StatefulView({
  status,
  empty,
  children,
  skeleton,
  error,
  onRetry,
  emptyTitle,
  emptyHint,
  emptyTips,
  emptyAction,
}: Props) {
  const styles = useStyles();
  const { lang } = useAuth();
  const { online } = useOutbox();

  if (status === 'loading') {
    return <>{skeleton ?? <SkeletonList rows={5} />}</>;
  }

  if (status === 'error') {
    // Offline vs server fault are different stories with different next actions.
    const offline = !online;
    const title = offline ? i18n.t(lang, 'error.offline_title') : i18n.t(lang, 'error.title');
    const body = offline
      ? i18n.t(lang, 'error.offline_body')
      : error || i18n.t(lang, 'error.generic');
    return (
      <View style={styles.center}>
        <Text style={styles.bigGlyph}>{offline ? '📡' : '⚠️'}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {onRetry ? (
          <Pressable
            onPress={() => {
              void haptic(motion.hapticToken.TAP_MEDIUM);
              onRetry();
            }}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel={i18n.t(lang, 'common.retry')}
          >
            <Text style={styles.retryText}>↻ {i18n.t(lang, 'common.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // ready
  if (empty) {
    return (
      <View style={styles.center}>
        <KafilLottie source={mascotIdle} motionClass={motion.MotionClass.E_MASCOT} style={styles.mascot} loop />
        {emptyTitle ? <Text style={styles.title}>{emptyTitle}</Text> : null}
        {emptyHint ? <Text style={styles.body}>{emptyHint}</Text> : null}
        {emptyTips && emptyTips.length ? (
          <View style={styles.tips}>
            {emptyTips.map((tip, i) => (
              <Text key={i} style={styles.tip}>
                {tip}
              </Text>
            ))}
          </View>
        ) : null}
        {emptyAction ? (
          <Pressable
            onPress={() => {
              void haptic(motion.hapticToken.TAP_MEDIUM);
              emptyAction.onPress();
            }}
            style={styles.primaryBtn}
            accessibilityRole="button"
            accessibilityLabel={emptyAction.label}
          >
            <Text style={styles.primaryText}>{emptyAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return <>{children}</>;
}

const useStyles = makeStyles((t) => ({
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.xxl,
  },
  mascot: { width: 120, height: 120, marginBottom: t.spacing.md },
  bigGlyph: { fontSize: 48, marginBottom: t.spacing.sm },
  title: { ...t.type.h2, color: t.colors.text, textAlign: 'center', marginBottom: t.spacing.xs },
  body: { ...t.type.body, color: t.colors.textMuted, textAlign: 'center', marginBottom: t.spacing.lg },
  tips: { alignSelf: 'stretch', gap: t.spacing.sm, marginBottom: t.spacing.lg },
  tip: {
    ...t.type.body,
    color: t.colors.text,
    backgroundColor: t.colors.surfaceSunken,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    overflow: 'hidden',
  },
  retryBtn: {
    backgroundColor: t.colors.primary,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    ...t.elevation(2),
  },
  retryText: { ...t.type.button, color: t.colors.textOnPrimary },
  primaryBtn: {
    backgroundColor: t.colors.primary,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    ...t.elevation(2),
  },
  primaryText: { ...t.type.button, color: t.colors.textOnPrimary },
}));

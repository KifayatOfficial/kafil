// §4 (resilience) — ERROR BOUNDARY. At 1M users on flaky networks and ₨15k Androids,
// a render-time throw in one screen must NEVER white-screen the whole app. This catches
// it, shows a friendly mascot + a big Reload, and lets the rest of the app keep working.
//
// React requires error boundaries to be class components (no hook equivalent for
// componentDidCatch), so this is the one class in the app. The visible fallback is a
// themed function component so it still respects light/dark + i18n.
//
// Placement (App.tsx): one boundary wraps each major screen region so a crash is scoped
// to that region, and a top-level boundary backstops the providers. `resetKeys` lets a
// parent clear the error when context changes (e.g. user navigates away).

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { i18n } from '@kafil/core';
import { useTheme } from '../theme';
import { Mascot } from '../mascot';

interface Props {
  children: ReactNode;
  /** A label for logs/telemetry so we know WHICH region threw (e.g. 'home', 'chat'). */
  label?: string;
  /** Optional custom fallback; defaults to <CrashFallback>. */
  fallback?: (reset: () => void) => ReactNode;
  /** When any value here changes, the boundary clears its error and re-renders children. */
  resetKeys?: unknown[];
  /** Hook for telemetry (P8). Called once per caught error. */
  onError?: (error: Error, info: ErrorInfo, label?: string) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort report. Until a telemetry sink exists, a dev console line is the
    // baseline; the onError hook lets P8 analytics/crash-reporting plug in later.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
    this.props.onError?.(error, info, this.props.label);
  }

  componentDidUpdate(prev: Props): void {
    // Clear the error when resetKeys change (parent signalled "the situation changed").
    if (this.state.error && prev.resetKeys && this.props.resetKeys) {
      const changed =
        prev.resetKeys.length !== this.props.resetKeys.length ||
        prev.resetKeys.some((k, i) => k !== this.props.resetKeys![i]);
      if (changed) this.setState({ error: null });
    }
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback ? (
        this.props.fallback(this.reset)
      ) : (
        <CrashFallback onReload={this.reset} />
      );
    }
    return this.props.children;
  }
}

/** Themed, low-literacy fallback: mascot + short message + a big Reload. */
function CrashFallback({ onReload }: { onReload: () => void }) {
  // Default to Pashto — the boundary may sit above AuthProvider (where `lang` lives), so
  // we can't assume a language context. ps is the primary user base (§12).
  const lang = 'ps';
  const { colors, spacing, radius, type, elevation } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg, padding: spacing.xl }]}>
      <Mascot pose="thinking" size={120} />
      <Text style={[type.h2, { color: colors.text, textAlign: 'center', marginTop: spacing.md }]}>
        {i18n.t(lang, 'error.crashed_title')}
      </Text>
      <Text style={[type.body, { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs }]}>
        {i18n.t(lang, 'error.crashed_body')}
      </Text>
      <Pressable
        onPress={onReload}
        accessibilityRole="button"
        accessibilityLabel={i18n.t(lang, 'common.reload')}
        style={[
          styles.btn,
          { backgroundColor: colors.primary, borderRadius: radius.pill, marginTop: spacing.lg },
          elevation(2),
        ]}
      >
        <Text style={[type.button, { color: colors.textOnPrimary }]}>↻ {i18n.t(lang, 'common.reload')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  btn: { paddingHorizontal: 28, paddingVertical: 14 },
});

// makeStyles — the bridge from static StyleSheet.create to theme-reactive styles.
//
// Before: const styles = StyleSheet.create({ root: { backgroundColor: motion.color.bg }})
// After:  const useStyles = makeStyles((t) => ({ root: { backgroundColor: t.colors.bg }}))
//         ...inside the component: const styles = useStyles();
//
// The factory runs once per scheme and the result is cached, so flipping light/dark
// rebuilds styles exactly once (not per render, not per component instance). This keeps
// the conversion mechanical — every screen's old `const styles = StyleSheet.create(...)`
// becomes a `makeStyles` factory + a one-line `useStyles()` call.

import { useMemo } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme, type Theme } from './ThemeContext';

// Mirror StyleSheet.create's own constraint so style-property literals (flexDirection:
// 'row', etc.) stay narrowed instead of widening to `object`.
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function makeStyles<T extends NamedStyles<T> | NamedStyles<unknown>>(
  factory: (theme: Theme) => T & NamedStyles<T>,
): () => T {
  // One compiled StyleSheet per scheme, lazily built and memoized across renders.
  const cache = new Map<string, T>();
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => {
      const hit = cache.get(theme.scheme);
      if (hit) return hit;
      const built = StyleSheet.create(factory(theme));
      cache.set(theme.scheme, built);
      return built;
    }, [theme]);
  };
}

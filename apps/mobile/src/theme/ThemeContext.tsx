// §27.9 — the mobile theming runtime. Resolves the active palette from the OS color
// scheme (useColorScheme) combined with a persisted user override, and exposes it via
// useTheme(). Screens never read raw hex or useColorScheme directly — they consume a
// resolved `Theme` so light/dark is a single source of truth.
//
// Mode model:
//   'system' — follow the OS (default; respects the device-wide setting)
//   'light' / 'dark' — explicit user override, persisted across launches
//
// The override is non-secret UI preference, so it lives in AsyncStorage (not SecureStore,
// which the storage.ts comment reserves for tokens).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { motion } from '@kafil/core';
import { elevation as elevationFor, typeScale, type ElevationLevel } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Theme {
  scheme: motion.ThemeScheme; // resolved 'light' | 'dark'
  mode: ThemeMode; // the user's setting (may be 'system')
  colors: motion.ThemePalette;
  spacing: typeof motion.spacing;
  radius: typeof motion.radius;
  type: typeof typeScale;
  /** Platform shadow for a given elevation level, pre-resolved for the active scheme. */
  elevation: (level: ElevationLevel) => ReturnType<typeof elevationFor>;
}

interface ThemeContextValue extends Theme {
  setMode: (mode: ThemeMode) => void;
  /** Convenience for the toggle: system → light → dark → system. */
  cycleMode: () => void;
}

const STORAGE_KEY = 'kafil.themeMode';

const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const osScheme = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Hydrate the persisted override once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
      if (!cancelled && (saved === 'light' || saved === 'dark' || saved === 'system')) {
        setModeState(saved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme: motion.ThemeScheme = mode === 'system' ? (osScheme === 'dark' ? 'dark' : 'light') : mode;

  const cycleMode = useCallback(() => {
    setMode(mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system');
  }, [mode, setMode]);

  const value = useMemo<ThemeContextValue>(() => {
    const colors = motion.themeColors[scheme];
    return {
      scheme,
      mode,
      colors,
      spacing: motion.spacing,
      radius: motion.radius,
      type: typeScale,
      elevation: (level: ElevationLevel) => elevationFor(level, scheme),
      setMode,
      cycleMode,
    };
  }, [scheme, mode, setMode, cycleMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used within <ThemeProvider>');
  return v;
}

// Mobile-only theme tokens that layer on top of the shared @kafil/core motion contract.
// Core owns the *values* (palettes, spacing, radius); this file owns the RN-specific
// shapes those values get poured into — elevation (shadow) presets and a typography
// scale — so every screen reaches for the same depth + text rhythm instead of
// re-deriving fontSize/shadow inline.

import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { motion } from '@kafil/core';

export type ElevationLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Elevation → platform shadow. Android uses `elevation`; iOS uses the shadow* quartet.
 * Shadow color is mode-aware: a soft warm shadow in light, a deeper black in dark so
 * raised surfaces still read against the near-black canvas. Levels:
 *   1 resting card · 2 raised card/banner · 3 sheet/menu · 4 modal/dialog
 */
export function elevation(level: ElevationLevel, scheme: motion.ThemeScheme): ViewStyle {
  if (level === 0) return {};
  const dark = scheme === 'dark';
  const shadowColor = dark ? motion.themeColors.dark.shadow : motion.themeColors.light.shadow;
  const spec: Record<Exclude<ElevationLevel, 0>, { o: number; r: number; y: number; e: number }> = {
    1: { o: dark ? 0.4 : 0.08, r: 4, y: 1, e: 2 },
    2: { o: dark ? 0.5 : 0.12, r: 10, y: 3, e: 5 },
    3: { o: dark ? 0.6 : 0.16, r: 20, y: 8, e: 10 },
    4: { o: dark ? 0.7 : 0.2, r: 32, y: 14, e: 18 },
  };
  const s = spec[level];
  return Platform.select<ViewStyle>({
    android: { elevation: s.e, shadowColor },
    default: {
      shadowColor,
      shadowOpacity: s.o,
      shadowRadius: s.r,
      shadowOffset: { width: 0, height: s.y },
    },
  })!;
}

// Typography scale — RTL-friendly (no italics; weight + size carry hierarchy). Sizes are
// generous for low-literacy / outdoor readability per §25. Line heights keep Pashto and
// Urdu diacritics from clipping.
export const typeScale = {
  hero: { fontSize: 36, fontWeight: '800', lineHeight: 44, letterSpacing: -0.5 },
  display: { fontSize: 30, fontWeight: '800', lineHeight: 38, letterSpacing: -0.4 },
  h1: { fontSize: 24, fontWeight: '700', lineHeight: 32, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700', lineHeight: 28, letterSpacing: -0.2 },
  h3: { fontSize: 17, fontWeight: '700', lineHeight: 24 },
  title: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  bodyLg: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  button: { fontSize: 15, fontWeight: '700', lineHeight: 20, letterSpacing: 0.2 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  overline: { fontSize: 11, fontWeight: '700', lineHeight: 14, letterSpacing: 0.8 },
  micro: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
} as const satisfies Record<string, TextStyle>;

export type TypeScale = typeof typeScale;

// §27 — design + motion tokens shared by mobile (Reanimated) and web (CSS).
// Each consumer adapts these values; the *tokens themselves* are the contract.

export const motionDuration = {
  xs: 80, // Class A micro-interaction min
  sm: 150, // Class A max
  md: 300, // Class C screen transition
  lg: 500,
  xl: 800, // Class D reward
  xxl: 1500, // Class D hero
} as const;

// Easing — names match common animation libs; consumers map to native curves.
export const motionEasing = {
  springDefault: { stiffness: 220, damping: 22, mass: 1 },
  springResponsive: { stiffness: 320, damping: 24, mass: 0.9 },
  easeEmphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// §27.3 — six classes. Engineers and designers reference these in PRs.
export const MotionClass = {
  A_MICRO: 'micro-interaction',
  B_STATE: 'state-change',
  C_TRANSITION: 'screen-transition',
  D_REWARD: 'reward-celebration',
  E_MASCOT: 'mascot',
  F_LOADING: 'loading-skeleton',
} as const;
export type MotionClass = (typeof MotionClass)[keyof typeof MotionClass];

// §27.4 lint thresholds — used by both the build-time linter and dev assertions.
export const lottieBudget: Record<MotionClass, { maxBytes: number; maxDurationMs: number }> = {
  [MotionClass.A_MICRO]: { maxBytes: 0, maxDurationMs: 0 }, // never use Lottie for A
  [MotionClass.B_STATE]: { maxBytes: 30_000, maxDurationMs: 400 },
  [MotionClass.C_TRANSITION]: { maxBytes: 0, maxDurationMs: 0 }, // never use Lottie for C
  [MotionClass.D_REWARD]: { maxBytes: 80_000, maxDurationMs: 1500 },
  [MotionClass.E_MASCOT]: { maxBytes: 60_000, maxDurationMs: 2000 },
  [MotionClass.F_LOADING]: { maxBytes: 20_000, maxDurationMs: 99999 },
};

// §27.5 — device tier drives Lottie variant selection + concurrent-animation cap.
export const DeviceTier = { A: 'tier_a', B: 'tier_b', C: 'tier_c' } as const;
export type DeviceTier = (typeof DeviceTier)[keyof typeof DeviceTier];

export const animationConcurrencyCap: Record<DeviceTier, number> = {
  tier_a: 2,
  tier_b: 1,
  tier_c: 0, // static PNG flashes only
};

// §27.8 — sound + haptic tokens. Consumers map to platform APIs; missing capability = silent no-op.
export const soundToken = {
  TAP: 'tap',
  TICK: 'tick',
  SUCCESS_SMALL: 'success_small',
  SUCCESS_BIG: 'success_big',
  ERROR_SOFT: 'error_soft',
  STREAK: 'streak',
  ARRIVE: 'arrive',
  NOTIFICATION_LOW: 'notification_low',
  NOTIFICATION_MED: 'notification_med',
  NOTIFICATION_HIGH: 'notification_high',
} as const;
export type SoundToken = (typeof soundToken)[keyof typeof soundToken];

export const hapticToken = {
  TAP_LIGHT: 'tap_light',
  TAP_MEDIUM: 'tap_medium',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  STREAK: 'streak',
} as const;
export type HapticToken = (typeof hapticToken)[keyof typeof hapticToken];

// Design tokens — color/spacing/radius/type. Brand is warm earth, not tech blue.
export const color = {
  bg: '#FAF7F2',
  bgDark: '#1B1814',
  surface: '#FFFFFF',
  surfaceDark: '#241F1A',
  text: '#221E1A',
  textDark: '#F2EDE6',
  primary: '#1F7A4D', // forest green — KAFIL trust
  primaryDark: '#22A668',
  accent: '#C2873A', // ochre — warmth
  danger: '#B23A2E',
  warning: '#C28A1E',
  // Trust-band shades for badges (§25.2 — never red/green alone, pair with shape+label).
  badgePhone: '#3A6FB2',
  badgeCnic: '#1F7A4D',
  badgeJobs: '#C2873A',
  badgeLocal: '#7E2EB2',
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 40,
  xxxl: 64,
} as const;
export const radius = { xs: 4, sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;

// Border widths — hairline is sub-pixel-aware on mobile (consumers can divide by PixelRatio).
export const borderWidth = { hairline: 1, thin: 1.5, thick: 2 } as const;

// Opacity ramp for disabled/pressed/scrim layering — keeps alpha consistent across UIs.
export const opacity = { disabled: 0.4, muted: 0.6, pressed: 0.85, scrim: 0.45 } as const;

// §27.9 — semantic theme palettes (light + dark). The flat `color` map above stays the
// brand contract (and web's CSS-var source); these resolve those brand hues into the
// *roles* a UI actually paints with, per mode. Consumers pick a palette by scheme and
// reference roles by meaning (`textMuted`, `border`, `elevated`) rather than raw hex —
// so a screen written once renders correctly in both light and dark.
//
// Brand hues (primary forest-green, ochre accent, trust-band badges) are intentionally
// shared across modes; only the neutrals, surfaces, borders, and tint washes flip.
export interface ThemePalette {
  // Backgrounds & surfaces, low → high elevation.
  bg: string; // app canvas
  bgElevated: string; // raised canvas (e.g. sheet backdrop content area)
  surface: string; // cards, inputs, tiles
  surfaceElevated: string; // surfaces that float above other surfaces (menus, FAB)
  surfaceSunken: string; // wells / track backgrounds / inset rows
  surfaceHover: string; // hover/pressed wash on an interactive surface (web hover, RN pressed)
  // Neutral ramp — a continuous gray scale tuned to the warm brand (not pure gray). Use
  // these when a semantic role doesn't fit (dividers between tiers, subtle fills, charts).
  // n0 = closest to bg, n900 = closest to text. Lets UIs build depth without inventing hex.
  neutral0: string;
  neutral50: string;
  neutral100: string;
  neutral200: string;
  neutral300: string;
  neutral400: string;
  neutral500: string;
  neutral600: string;
  neutral700: string;
  neutral800: string;
  neutral900: string;
  // Text tiers.
  text: string; // primary content
  textMuted: string; // secondary / helper text (replaces ad-hoc #666/#888)
  textFaint: string; // tertiary / disabled / timestamps
  textOnPrimary: string; // text/icon sitting on a primary-filled surface
  textOnAccent: string; // text/icon on an accent-filled surface
  textLink: string; // inline tappable text
  // Lines & separators.
  border: string; // hairline dividers, card outlines
  borderStrong: string; // emphasized outlines (focused input, selected tile)
  borderFocus: string; // focus ring / active input outline
  // Brand roles. Each role has: base, soft (tinted fill), and strong (pressed/active) variants.
  primary: string; // forest green — primary actions, trust
  primarySoft: string; // tinted fill behind primary (chips, soft buttons)
  primaryStrong: string; // pressed / active primary
  accent: string; // ochre warmth
  accentSoft: string; // tinted ochre fill
  accentStrong: string;
  danger: string;
  dangerSoft: string; // tinted danger fill (destructive backgrounds)
  dangerStrong: string;
  warning: string;
  warningSoft: string;
  warningStrong: string;
  success: string; // semantic success (maps to primary green family)
  successSoft: string;
  successStrong: string;
  info: string; // teal/blue — neutral informational (banners, sync, tips)
  infoSoft: string;
  infoStrong: string;
  // Utility.
  overlay: string; // modal scrim
  skeleton: string; // loading shimmer block base
  skeletonHighlight: string; // shimmer sweep highlight (gradient endpoint)
  shadow: string; // base shadow color for elevation
  // Gradients — pairs consumers can feed into LinearGradient (mobile) / linear-gradient (web).
  // Each is [from, to]; brand gradient is the signature forest→ochre sweep.
  gradientBrand: readonly [string, string];
  gradientSurface: readonly [string, string]; // subtle top-light card sheen
  // Trust-band badge hues (shared; §25.2 pairs them with shape + label, never color alone).
  badgePhone: string;
  badgeCnic: string;
  badgeJobs: string;
  badgeLocal: string;
  // Domain accent hues — give each platform layer (§ marketplace/community/directory) a
  // recognizable tint so Jobs / Shops / Community read as distinct without extra chrome.
  domainJobs: string;
  domainShops: string;
  domainCommunity: string;
}

export const themeColors: { light: ThemePalette; dark: ThemePalette } = {
  light: {
    bg: '#FAF7F2',
    bgElevated: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceSunken: '#F1EBE2',
    surfaceHover: '#F3EEE6',
    neutral0: '#FFFFFF',
    neutral50: '#FAF7F2',
    neutral100: '#F1EBE2',
    neutral200: '#EAE3D9',
    neutral300: '#D8CFC2',
    neutral400: '#BFB4A4',
    neutral500: '#9A9189',
    neutral600: '#6B6258',
    neutral700: '#4A433B',
    neutral800: '#332E28',
    neutral900: '#221E1A',
    text: '#221E1A',
    textMuted: '#6B6258',
    textFaint: '#9A9189',
    textOnPrimary: '#FFFFFF',
    textOnAccent: '#2A1B08',
    textLink: '#1F7A4D',
    border: '#EAE3D9',
    borderStrong: '#D8CFC2',
    borderFocus: '#1F7A4D',
    primary: '#1F7A4D',
    primarySoft: '#E4F1EA',
    primaryStrong: '#185E3B',
    accent: '#C2873A',
    accentSoft: '#F6ECDC',
    accentStrong: '#9E6C28',
    danger: '#B23A2E',
    dangerSoft: '#F7E2DF',
    dangerStrong: '#8C2C22',
    warning: '#C28A1E',
    warningSoft: '#F8EED7',
    warningStrong: '#9A6D12',
    success: '#1F7A4D',
    successSoft: '#E4F1EA',
    successStrong: '#185E3B',
    info: '#2A7DA3',
    infoSoft: '#E0EEF4',
    infoStrong: '#1F6080',
    overlay: 'rgba(27, 24, 20, 0.45)',
    skeleton: '#E9E2D9',
    skeletonHighlight: '#F5F0E8',
    shadow: '#3A2E1F',
    gradientBrand: ['#1F7A4D', '#C2873A'],
    gradientSurface: ['#FFFFFF', '#FAF7F2'],
    badgePhone: '#3A6FB2',
    badgeCnic: '#1F7A4D',
    badgeJobs: '#C2873A',
    badgeLocal: '#7E2EB2',
    domainJobs: '#1F7A4D',
    domainShops: '#C2873A',
    domainCommunity: '#7E2EB2',
  },
  dark: {
    bg: '#1B1814',
    bgElevated: '#241F1A',
    surface: '#241F1A',
    surfaceElevated: '#2E2823',
    surfaceSunken: '#161310',
    surfaceHover: '#2E2823',
    neutral0: '#161310',
    neutral50: '#1B1814',
    neutral100: '#241F1A',
    neutral200: '#2E2823',
    neutral300: '#352E27',
    neutral400: '#473E35',
    neutral500: '#6B6055',
    neutral600: '#857C71',
    neutral700: '#A79D90',
    neutral800: '#CFC6BA',
    neutral900: '#F2EDE6',
    text: '#F2EDE6',
    textMuted: '#B7AEA2',
    textFaint: '#857C71',
    textOnPrimary: '#0E1F16',
    textOnAccent: '#241803',
    textLink: '#3FBE82',
    border: '#352E27',
    borderStrong: '#473E35',
    borderFocus: '#22A668',
    primary: '#22A668',
    primarySoft: '#16352A',
    primaryStrong: '#2FBE7C',
    accent: '#D49A4F',
    accentSoft: '#33291A',
    accentStrong: '#E2AC63',
    danger: '#E06352',
    dangerSoft: '#3A211D',
    dangerStrong: '#EC7A6B',
    warning: '#D8A53C',
    warningSoft: '#352B17',
    warningStrong: '#E6B85A',
    success: '#22A668',
    successSoft: '#16352A',
    successStrong: '#2FBE7C',
    info: '#56AECE',
    infoSoft: '#16303A',
    infoStrong: '#74C2DE',
    overlay: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#322B24',
    skeletonHighlight: '#3E362E',
    shadow: '#000000',
    gradientBrand: ['#22A668', '#D49A4F'],
    gradientSurface: ['#2E2823', '#241F1A'],
    badgePhone: '#5B8BD0',
    badgeCnic: '#22A668',
    badgeJobs: '#D49A4F',
    badgeLocal: '#A86BD8',
    domainJobs: '#22A668',
    domainShops: '#D49A4F',
    domainCommunity: '#A86BD8',
  },
};

export type ThemeScheme = keyof typeof themeColors;

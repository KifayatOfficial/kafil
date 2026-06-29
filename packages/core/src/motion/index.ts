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

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 40 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

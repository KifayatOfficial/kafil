// §27 (Class-D reward) — the MOMENT REGISTRY.
//
// A "moment" is a celebration: the multi-sensory beat that fires when something
// meaningful happens (got hired, got paid, earned 5 stars, hit a milestone). These are
// the screenshots people show their friends — the difference between an app that works
// and an app that's loved. Per the roadmap (Phase 2.1), celebrations are DECLARATIVE:
// one registry maps a key → choreography, so any screen calls `celebrate('hired')` and
// the host plays the right Lottie + sound + haptic + mascot pose consistently.
//
// Every moment is budget-bound (§27.4 Class-D: ≤80KB Lottie, ≤1500ms) and degrades
// gracefully: reduce-motion / tier-C → static badge + haptic, no animation; no sound
// asset → silent; no haptic capability → no-op. Nothing here ever blocks interaction.

import { motion } from '@kafil/core';

/** Stable keys for every celebratable moment. Add here as flows gain rewards. */
export type MomentKey =
  | 'hired' // worker's application was accepted — the headline moment
  | 'paid' // wallet credited / payout settled
  | 'job_posted' // employer posted a job (ripples out to nearby workers)
  | 'five_star' // received a 5★ review
  | 'milestone' // Nth job / referral milestone / level-up
  | 'first_post'; // first community post

/** Mascot reaction pose to strike during the moment (consumed by the mascot system, P2.4). */
export type MascotPose = 'cheer' | 'proud' | 'wave' | 'sparkle' | 'levelup';

export interface MomentDef {
  /** Big emoji shown in the celebration card + as the reduce-motion static fallback. */
  glyph: string;
  /** Headline + sub copy keys are resolved by the caller via i18n; we keep raw fallbacks. */
  title: string;
  subtitle: string;
  /** Haptic crescendo for the beat (degrades to no-op without hardware). */
  haptic: motion.HapticToken;
  /** Sound token (mapped to an asset by the player; silent if unmapped). */
  sound: motion.SoundToken;
  /** Mascot pose to strike. */
  mascotPose: MascotPose;
  /** On-screen duration before auto-dismiss (ms). Bounded by Class-D budget (≤1500). */
  durationMs: number;
  /** Whether this moment offers a "share" action (growth loop, P6). */
  shareable: boolean;
  /** Accent role from the theme palette used to tint the celebration. */
  tone: 'success' | 'accent' | 'primary' | 'info';
}

export const MOMENTS: Record<MomentKey, MomentDef> = {
  hired: {
    glyph: '🎉',
    title: 'You got the job!',
    subtitle: 'The employer accepted you. Confirm to lock it in.',
    haptic: motion.hapticToken.SUCCESS,
    sound: motion.soundToken.SUCCESS_BIG,
    mascotPose: 'cheer',
    durationMs: 1500,
    shareable: true,
    tone: 'success',
  },
  paid: {
    glyph: '💰',
    title: 'You got paid!',
    subtitle: 'Your balance just went up.',
    haptic: motion.hapticToken.SUCCESS,
    sound: motion.soundToken.SUCCESS_BIG,
    mascotPose: 'proud',
    durationMs: 1400,
    shareable: false,
    tone: 'accent',
  },
  job_posted: {
    glyph: '📣',
    title: 'Job posted',
    subtitle: 'We’re telling workers near you.',
    haptic: motion.hapticToken.SUCCESS,
    sound: motion.soundToken.SUCCESS_SMALL,
    mascotPose: 'wave',
    durationMs: 1200,
    shareable: true,
    tone: 'primary',
  },
  five_star: {
    glyph: '⭐',
    title: 'Five stars!',
    subtitle: 'Your reputation just grew.',
    haptic: motion.hapticToken.SUCCESS,
    sound: motion.soundToken.SUCCESS_SMALL,
    mascotPose: 'sparkle',
    durationMs: 1300,
    shareable: true,
    tone: 'accent',
  },
  milestone: {
    glyph: '🏆',
    title: 'Milestone reached!',
    subtitle: 'Keep going — you’re building something.',
    haptic: motion.hapticToken.STREAK,
    sound: motion.soundToken.STREAK,
    mascotPose: 'levelup',
    durationMs: 1500,
    shareable: true,
    tone: 'primary',
  },
  first_post: {
    glyph: '👋',
    title: 'Welcome to the conversation',
    subtitle: 'Your first post is live.',
    haptic: motion.hapticToken.SUCCESS,
    sound: motion.soundToken.SUCCESS_SMALL,
    mascotPose: 'wave',
    durationMs: 1100,
    shareable: false,
    tone: 'info',
  },
};

// §27 Class-E (mascot) — POSE REGISTRY.
//
// The mascot is the app's low-literacy personality: a friendly guide that reacts to what
// the user is doing (idle, thinking while loading, cheering on a win, pointing at the
// next action, sleeping when offline). Each pose maps to a Lottie asset.
//
// Reality today: only `mascot_idle.json` is bundled. So every pose resolves to idle for
// now and the system is visually consistent immediately; when a designer delivers
// per-pose assets, dropping files in + filling POSE_ASSETS lights them up with NO call-
// site changes (same config-over-code philosophy as voice recordings and sound tokens).

export type MascotPose =
  | 'idle' // resting / default
  | 'thinking' // loading / working
  | 'cheer' // celebration (paired with Class-D moments)
  | 'proud' // softer win (paid, review)
  | 'wave' // greeting / welcome
  | 'point' // coach-mark: draw the eye to the primary action
  | 'sparkle' // reward shimmer
  | 'sleep'; // offline / idle-long

// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDLE = require('../../assets/lottie/mascot_idle.json');

// Per-pose asset overrides. Empty entries fall back to IDLE. Populate as assets land:
//   cheer: require('../../assets/lottie/mascot_cheer.json'),
const POSE_ASSETS: Partial<Record<MascotPose, unknown>> = {};

/** Resolve a pose to its Lottie source, falling back to idle when no asset exists yet. */
export function poseAsset(pose: MascotPose): unknown {
  return POSE_ASSETS[pose] ?? IDLE;
}

/** Whether a pose has a dedicated asset (vs. falling back to idle) — for tests/tooling. */
export function poseHasAsset(pose: MascotPose): boolean {
  return POSE_ASSETS[pose] != null;
}

// Poses that should loop when shown (ambient) vs. play once (reactive beats).
const LOOPING: ReadonlySet<MascotPose> = new Set<MascotPose>(['idle', 'thinking', 'sleep']);
export function poseLoops(pose: MascotPose): boolean {
  return LOOPING.has(pose);
}

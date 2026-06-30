// §27.8 — sound token → asset player for moments. Mirrors VoiceContext's expo-av
// discipline (single sound, self-unload, silent on failure). Sound assets are optional:
// until they're bundled, every token resolves to null and play() is a silent no-op —
// exactly like haptics on tier_c or unconfigured voice. Haptic + visual always carry
// the moment, so shipping without sound is fine.
//
// To enable: drop AAC/m4a files under assets/sound/<token>.m4a and populate SOUND_ASSETS
// with `require(...)` entries. No call site changes.

import { Audio } from 'expo-av';
import type { motion } from '@kafil/core';

// Asset map — intentionally empty until a sound designer delivers files (roadmap P5).
// Keyed by SoundToken; value is a require()'d module id. Missing key → silent.
const SOUND_ASSETS: Partial<Record<motion.SoundToken, number>> = {
  // success_big: require('../../assets/sound/success_big.m4a'),
};

let active: Audio.Sound | null = null;

async function unload(): Promise<void> {
  const s = active;
  active = null;
  if (s) await s.unloadAsync().catch(() => undefined);
}

/** Play a sound token once. No-op when no asset is mapped or playback fails. */
export async function playSound(token: motion.SoundToken | string): Promise<void> {
  const asset = SOUND_ASSETS[token as motion.SoundToken];
  if (asset == null) return; // no asset bundled → silent
  try {
    await unload();
    const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: true });
    active = sound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) void unload();
    });
  } catch {
    await unload();
  }
}

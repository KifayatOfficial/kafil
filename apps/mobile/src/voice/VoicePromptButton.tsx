// §25.1 — the 🔊 "tap to hear" affordance + an autoplay-on-enter hook.
//
// Pattern from the spec: "tap when you hear what you want", ≥ 1 voice prompt per
// screen. A screen autoplays its prompt once on mount (useVoicePrompt) and also shows
// a VoicePromptButton so the user can replay it. Both no-op gracefully when there's no
// recording — the button simply doesn't render.

import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { motion, type VoiceKey } from '@kafil/core';
import { useVoice } from './VoiceContext';
import { haptic } from '../motion/feedback';
import { makeStyles } from '../theme';

/**
 * Autoplay a screen's voice prompt once when it mounts. Safe to call unconditionally:
 * it's a no-op when narration isn't configured. Re-fires if the key changes.
 */
export function useVoicePrompt(key: VoiceKey): void {
  const { play } = useVoice();
  useEffect(() => {
    void play(key);
  }, [key, play]);
}

/**
 * A round 🔊 button that replays a prompt. Renders nothing when no recording exists,
 * so callers can drop it in unconditionally without leaving a dead control on screen.
 */
export function VoicePromptButton({
  promptKey,
  accessibilityLabel,
}: {
  promptKey: VoiceKey;
  accessibilityLabel: string;
}) {
  const { play, available } = useVoice();
  const styles = useStyles();
  if (!available(promptKey)) {
    return null;
  }
  return (
    <Pressable
      onPress={() => {
        void haptic(motion.hapticToken.TAP_LIGHT);
        void play(promptKey);
      }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.btn}
    >
      <Text style={styles.icon}>🔊</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  btn: {
    width: 44,
    height: 44,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.primary,
  },
  icon: { fontSize: 20 },
}));

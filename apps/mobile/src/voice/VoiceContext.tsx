// §25.1 — mobile voice-prompt player. Plays the recorded narration the core
// VoiceCatalog resolves, with a single-sound discipline (a new prompt stops the
// previous one) so two prompts never talk over each other.
//
// Degradation is first-class: when no audio is configured (dev / network-restricted
// env) or a given (lang,key) has no recording, play() is a silent no-op and
// available() returns false — so screens hide the 🔊 affordance instead of offering
// a button that does nothing. This mirrors haptics on tier_c and the emoji-icon
// fallback in the specialty picker.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import { VoiceCatalog, type VoiceKey } from '@kafil/core';
import { useAuth } from '../auth/AuthContext';

interface VoiceContextValue {
  /** Play the prompt for the current language. No-op when there's no recording. */
  play: (key: VoiceKey) => Promise<void>;
  /** Stop whatever is currently playing. */
  stop: () => Promise<void>;
  /** True when a recording exists for this key in the current language. */
  available: (key: VoiceKey) => boolean;
}

const Ctx = createContext<VoiceContextValue | null>(null);

const VOICE_BASE_URL =
  (Constants.expoConfig?.extra as { voiceBaseUrl?: string } | undefined)?.voiceBaseUrl ?? '';

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { lang } = useAuth();
  // The catalog is config-driven and stable for the app's lifetime.
  const catalog = useMemo(() => new VoiceCatalog({ baseUrl: VOICE_BASE_URL }), []);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Let prompts play through the earpiece/speaker even when the ringer is on silent —
  // low-end Androids are frequently muted, and a narration the user can't hear defeats
  // the entire low-literacy onboarding. Best-effort; failures are non-fatal.
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => undefined);
  }, []);

  const unload = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) await s.unloadAsync().catch(() => undefined);
  }, []);

  // Unload on unmount so we never leak a native sound handle.
  useEffect(() => {
    return () => {
      void unload();
    };
  }, [unload]);

  const stop = useCallback(async () => {
    await unload();
  }, [unload]);

  const play = useCallback(
    async (key: VoiceKey) => {
      const uri = catalog.resolve(lang, key);
      if (!uri) return; // no recording → silent no-op
      try {
        await unload(); // single-sound discipline: stop the previous prompt first
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        soundRef.current = sound;
        // Self-unload when playback finishes so a later play() starts clean.
        sound.setOnPlaybackStatusUpdate((status) => {
          if ('didJustFinish' in status && status.didJustFinish) void unload();
        });
      } catch {
        // Network blip / decode failure → fail silent; text + icons still carry the screen.
        await unload();
      }
    },
    [catalog, lang, unload],
  );

  const available = useCallback(
    (key: VoiceKey) => catalog.resolve(lang, key) !== null,
    [catalog, lang],
  );

  const value = useMemo<VoiceContextValue>(
    () => ({ play, stop, available }),
    [play, stop, available],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>');
  return ctx;
}

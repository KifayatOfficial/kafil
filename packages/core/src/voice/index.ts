// §25.1 — VOICE PROMPT CATALOG (recorded narration for low-literacy onboarding).
//
// The spec is explicit: "recorded Pashto/Urdu narration, NOT TTS". So this module
// does not synthesize anything — it maps a (lang, prompt-key) pair to the URL of a
// pre-recorded audio file, the same way i18n maps (lang, string-key) to text.
//
// Why a catalog instead of hard-coded URLs at call sites (mirrors i18n + motion):
//   - The set of prompts is typed, so a screen can't reference a prompt that doesn't
//     exist, and we can assert per-language coverage in tests.
//   - The audio CDN base is configured once (prod) and is empty in dev / network-
//     restricted envs — in which case resolution returns null and the player degrades
//     to a silent no-op (exactly like haptics on tier_c, or the emoji icon fallback).
//   - Dropping in real recordings is a CONFIG change (set the base + upload files at
//     the documented path), not a code change. No call site moves.
//
// File path convention (documented so the voice-actor pipeline is unambiguous):
//   <base>/<lang>/<key>.m4a       e.g.  https://cdn.kafil.pk/voice/ps/onboarding.welcome.m4a
// m4a (AAC) is chosen for size on 2G and universal Android/iOS decode.

import type { Lang } from '../schemas/common';

/**
 * Every recordable prompt. Keep these aligned with the onboarding flow; a prompt key
 * SHOULD correspond to an i18n string key where one exists, so the recording and the
 * on-screen text say the same thing. Add keys here as flows gain narration.
 */
export type VoiceKey =
  | 'onboarding.welcome' // PhoneEntry — "Salaam, welcome to KAFIL. Enter your phone number."
  | 'onboarding.otp' // Otp — "We sent you a 6-digit code. Type it here."
  | 'onboarding.role' // Role — "Do you want to find work, or hire workers? Tap one."
  | 'onboarding.specialties'; // WorkerSpecialties — "Tap the kinds of work you do."

const ALL_KEYS: readonly VoiceKey[] = [
  'onboarding.welcome',
  'onboarding.otp',
  'onboarding.role',
  'onboarding.specialties',
];

/** Languages we record narration for. English users can read; ps/ur are the priority. */
const VOICED_LANGS: readonly Lang[] = ['ps', 'ur'];

export interface VoiceCatalogConfig {
  /**
   * Base URL for recorded audio (no trailing slash). Empty/undefined → narration is
   * not configured in this environment and every resolve() returns null.
   */
  baseUrl?: string;
  /** File extension for recordings. Defaults to 'm4a'. */
  ext?: string;
  /**
   * Optional explicit allowlist of (lang/key) pairs that actually have a recording,
   * as `"<lang>/<key>"` strings. When provided, resolve() returns null for anything
   * not listed — so a half-recorded catalog never points at 404s. When omitted, all
   * VOICED_LANGS × ALL_KEYS are assumed present (prod, fully recorded).
   */
  available?: readonly string[];
}

/** Pure catalog: resolves a (lang, key) to an audio URL, or null when unavailable. */
export class VoiceCatalog {
  private readonly base: string;
  private readonly ext: string;
  private readonly available: ReadonlySet<string> | null;

  constructor(cfg: VoiceCatalogConfig = {}) {
    this.base = (cfg.baseUrl ?? '').replace(/\/$/, '');
    this.ext = cfg.ext ?? 'm4a';
    this.available = cfg.available ? new Set(cfg.available) : null;
  }

  /** True when narration is configured at all in this environment. */
  isConfigured(): boolean {
    return this.base.length > 0;
  }

  /**
   * The audio URL for a prompt in a language, or null when there's no recording
   * (unconfigured env, non-voiced language, or not in the `available` allowlist).
   * Callers treat null as "no voice" and fall back to text + icons only.
   */
  resolve(lang: Lang, key: VoiceKey): string | null {
    if (!this.isConfigured()) return null;
    // English is read, not narrated; fall through to ur as a courtesy is wrong here —
    // if a screen requests English narration we simply have none.
    if (!VOICED_LANGS.includes(lang)) return null;
    const id = `${lang}/${key}`;
    if (this.available && !this.available.has(id)) return null;
    return `${this.base}/${id}.${this.ext}`;
  }

  /** All keys (for tests / authoring tooling). */
  keys(): readonly VoiceKey[] {
    return ALL_KEYS;
  }
}

export { ALL_KEYS as voiceKeys, VOICED_LANGS as voicedLangs };

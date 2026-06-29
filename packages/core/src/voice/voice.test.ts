// §25.1 voice catalog tests. Pure resolution logic — no audio, no platform.

import { describe, it, expect } from 'vitest';
import { VoiceCatalog, voiceKeys, voicedLangs } from './index';

describe('VoiceCatalog — configuration gating', () => {
  it('resolves to null everywhere when no baseUrl is set (dev / restricted env)', () => {
    const c = new VoiceCatalog();
    expect(c.isConfigured()).toBe(false);
    for (const k of voiceKeys) {
      expect(c.resolve('ps', k)).toBeNull();
      expect(c.resolve('ur', k)).toBeNull();
    }
  });

  it('builds the documented <base>/<lang>/<key>.<ext> URL when configured', () => {
    const c = new VoiceCatalog({ baseUrl: 'https://cdn.kafil.pk/voice' });
    expect(c.resolve('ps', 'onboarding.welcome')).toBe(
      'https://cdn.kafil.pk/voice/ps/onboarding.welcome.m4a',
    );
    expect(c.resolve('ur', 'onboarding.role')).toBe(
      'https://cdn.kafil.pk/voice/ur/onboarding.role.m4a',
    );
  });

  it('strips a trailing slash on the base and honors a custom ext', () => {
    const c = new VoiceCatalog({ baseUrl: 'https://x/voice/', ext: 'mp3' });
    expect(c.resolve('ps', 'onboarding.otp')).toBe('https://x/voice/ps/onboarding.otp.mp3');
  });
});

describe('VoiceCatalog — language policy', () => {
  it('returns null for English (read, not narrated) even when configured', () => {
    const c = new VoiceCatalog({ baseUrl: 'https://x' });
    expect(c.resolve('en', 'onboarding.welcome')).toBeNull();
  });

  it('voiced languages are exactly ps + ur', () => {
    expect([...voicedLangs].sort()).toEqual(['ps', 'ur']);
  });
});

describe('VoiceCatalog — partial availability allowlist', () => {
  it('returns null for pairs not in the available set (no 404s on a half-recorded catalog)', () => {
    const c = new VoiceCatalog({
      baseUrl: 'https://x',
      available: ['ps/onboarding.welcome'],
    });
    expect(c.resolve('ps', 'onboarding.welcome')).toBe('https://x/ps/onboarding.welcome.m4a');
    expect(c.resolve('ps', 'onboarding.role')).toBeNull(); // recorded later
    expect(c.resolve('ur', 'onboarding.welcome')).toBeNull(); // ur not recorded yet
  });
});

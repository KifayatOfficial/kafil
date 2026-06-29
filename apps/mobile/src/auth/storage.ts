// Encrypted-at-rest token storage for mobile.
// expo-secure-store uses Keychain (iOS) / EncryptedSharedPreferences (Android).
// Refresh tokens are sensitive; access tokens are short-lived but we still avoid plain
// AsyncStorage for them. Non-secret state (lastUserId, preferred lang) goes in plain
// storage when we add it.

import * as SecureStore from 'expo-secure-store';

const K = {
  accessToken: 'kafil.accessToken',
  refreshToken: 'kafil.refreshToken',
  userId: 'kafil.userId',
  sessionId: 'kafil.sessionId',
  cooldownUntil: 'kafil.cooldownUntil',
  deviceFingerprint: 'kafil.deviceFingerprint',
} as const;

export interface PersistedSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  sessionId: string;
  /** Epoch-ms cooldown expiry (§24/A1). null when no cooldown. */
  cooldownUntil: number | null;
}

export async function saveSession(s: PersistedSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(K.accessToken, s.accessToken),
    SecureStore.setItemAsync(K.refreshToken, s.refreshToken),
    SecureStore.setItemAsync(K.userId, s.userId),
    SecureStore.setItemAsync(K.sessionId, s.sessionId),
    SecureStore.setItemAsync(K.cooldownUntil, s.cooldownUntil?.toString() ?? ''),
  ]);
}

export async function loadSession(): Promise<PersistedSession | null> {
  const [accessToken, refreshToken, userId, sessionId, cooldownStr] = await Promise.all([
    SecureStore.getItemAsync(K.accessToken),
    SecureStore.getItemAsync(K.refreshToken),
    SecureStore.getItemAsync(K.userId),
    SecureStore.getItemAsync(K.sessionId),
    SecureStore.getItemAsync(K.cooldownUntil),
  ]);
  if (!accessToken || !refreshToken || !userId || !sessionId) return null;
  const cooldownUntil = cooldownStr ? Number.parseInt(cooldownStr, 10) || null : null;
  return { accessToken, refreshToken, userId, sessionId, cooldownUntil };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(K.accessToken).catch(() => undefined),
    SecureStore.deleteItemAsync(K.refreshToken).catch(() => undefined),
    SecureStore.deleteItemAsync(K.userId).catch(() => undefined),
    SecureStore.deleteItemAsync(K.sessionId).catch(() => undefined),
    SecureStore.deleteItemAsync(K.cooldownUntil).catch(() => undefined),
  ]);
}

/**
 * Returns a stable device fingerprint persisted across launches. First use generates
 * a UUID; subsequent use reads it back. NOT a hardware identifier (those require
 * extra permissions on Android 10+). For real device-binding we add expo-application
 * + a server-validated attestation flow later.
 */
export async function getDeviceFingerprint(generate: () => string): Promise<string> {
  let v = await SecureStore.getItemAsync(K.deviceFingerprint);
  if (!v) {
    v = generate();
    await SecureStore.setItemAsync(K.deviceFingerprint, v);
  }
  return v;
}

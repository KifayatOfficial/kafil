// React context for session state. The single source of truth for "am I signed in?"
// — components subscribe to this rather than reading SecureStore directly.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager } from 'react-native';
import Constants from 'expo-constants';
import {
  KafilApiClient,
  KafilAuth,
  randomUUID,
  type Lang,
} from '@kafil/core';
import {
  clearSession,
  getDeviceFingerprint,
  loadSession,
  saveSession,
  type PersistedSession,
} from './storage';

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: PersistedSession | null;
  /** UI language (§12). Sourced from the user's preferred_lang; defaults to Pashto. */
  lang: Lang;
  /** True when the active session is in §24/A1 cooldown (no money actions). */
  inCooldown: boolean;
  /** Trigger sign-in flow components; throws on validation. */
  requestOtp: (phone: string) => Promise<{ sent: true }>;
  verifyOtp: (
    phone: string,
    otp: string,
  ) => Promise<{ userId: string; isNew: boolean; cooldown: boolean }>;
  signOut: () => Promise<void>;
  /** Typed API client bound to current session (rotates token automatically). */
  api: KafilApiClient;
  auth: KafilAuth;
  deviceFingerprint: string;
}

const Ctx = createContext<AuthState | null>(null);

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:3001';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [session, setSession] = useState<PersistedSession | null>(null);
  const [fingerprint, setFingerprint] = useState<string>('');
  // Default Pashto (the primary low-literacy user base, §12). Both Pashto and Urdu are
  // RTL, so we enable RTL at startup; English users are the exception, flipped on /me.
  const [lang, setLang] = useState<Lang>('ps');

  // Build one client; getAccessToken closes over `session` state so token rotation works.
  const sessionRef = useStableRef(session);
  const api = useMemo(
    () =>
      new KafilApiClient({
        baseUrl: API_URL,
        getAccessToken: () => sessionRef.current?.accessToken ?? null,
        onUnauthorized: async () => {
          // Soft handler: try refresh once. If refresh fails, sign out.
          const cur = sessionRef.current;
          if (!cur) return;
          const r = await fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: cur.refreshToken }),
          })
            .then((res) => res.json() as Promise<{ ok: boolean; value?: { accessToken: string; refreshToken: string } }>)
            .catch(() => ({ ok: false } as { ok: false }));
          if (r.ok && r.value) {
            const next: PersistedSession = {
              ...cur,
              accessToken: r.value.accessToken,
              refreshToken: r.value.refreshToken,
            };
            await saveSession(next);
            setSession(next);
            return;
          }
          await clearSession();
          setSession(null);
          setStatus('signedOut');
        },
      }),
    [sessionRef],
  );
  const auth = useMemo(() => new KafilAuth(api), [api]);

  // Bootstrap on mount.
  useEffect(() => {
    (async () => {
      const [s, fp] = await Promise.all([loadSession(), getDeviceFingerprint(randomUUID)]);
      setFingerprint(fp);
      if (s) {
        setSession(s);
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    })().catch((e: unknown) => {
      console.warn('auth bootstrap failed', e);
      setStatus('signedOut');
    });
  }, []);

  // §12 — sync UI language from the signed-in user's preference, and align native RTL.
  // I18nManager.forceRTL only takes full effect after a reload, but calling it keeps the
  // layout direction correct on next launch and lets logical (start/end) styles resolve.
  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    (async () => {
      const r = await api.get<{ ok: true; user: { preferredLang?: string } }>('/api/auth/me');
      if (cancelled || !r.success) return;
      const pl = (r.data as { user?: { preferredLang?: string } }).user?.preferredLang;
      const next: Lang = pl === 'ur' ? 'ur' : pl === 'en' ? 'en' : 'ps';
      setLang(next);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, api]);

  useEffect(() => {
    const rtl = lang === 'ps' || lang === 'ur';
    try {
      I18nManager.allowRTL(rtl);
      if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
    } catch {
      // I18nManager unavailable in some test/web contexts — non-fatal.
    }
  }, [lang]);

  const requestOtp = useCallback(
    async (phone: string) => {
      const r = await auth.requestOtp({ phone_e164: phone, device_fingerprint: fingerprint });
      if (!r.success) throw new Error((r.data as { message?: string }).message ?? 'OTP request failed');
      return { sent: true as const };
    },
    [auth, fingerprint],
  );

  const verifyOtp = useCallback(
    async (phone: string, otp: string) => {
      const r = await auth.verifyOtp({
        phone_e164: phone,
        otp,
        device_fingerprint: fingerprint,
      });
      if (!r.success || !('value' in r.data && r.data.value)) {
        throw new Error((r.data as { message?: string }).message ?? 'OTP verification failed');
      }
      const v = r.data.value;
      const cooldown = v.cooldown ?? false;
      const next: PersistedSession = {
        accessToken: v.accessToken,
        refreshToken: v.refreshToken,
        userId: v.userId,
        sessionId: v.sessionId,
        cooldownUntil: cooldown ? Date.now() + 24 * 60 * 60_000 : null,
      };
      await saveSession(next);
      setSession(next);
      setStatus('signedIn');
      return { userId: v.userId, isNew: v.isNew, cooldown };
    },
    [auth, fingerprint],
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setStatus('signedOut');
  }, []);

  const inCooldown = !!session?.cooldownUntil && session.cooldownUntil > Date.now();

  const value: AuthState = {
    status,
    session,
    lang,
    inCooldown,
    requestOtp,
    verifyOtp,
    signOut,
    api,
    auth,
    deviceFingerprint: fingerprint,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** A stable ref that always points at the latest `value`. Lets memoized clients
 *  read fresh state without re-binding their callbacks. */
function useStableRef<T>(value: T): { current: T } {
  const [ref] = useState<{ current: T }>(() => ({ current: value }));
  ref.current = value;
  return ref;
}

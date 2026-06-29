// Typed API client shared by apps/mobile + apps/web.
// Design goals (all enforced here, not at call sites):
//   - Idempotency-Key on every mutation (§24/A7), generated automatically per call.
//   - Authorization: Bearer <accessToken> when authed.
//   - Result<T> mirror of the server's Result type — no `throw` at success path.
//   - Retry-with-backoff on 5xx + network failure (mobile §13 outbox primitive).
//   - 24h-session cooldown / 401 / refresh hooks delegated to the caller via callbacks
//     so this module stays storage-agnostic (works in mobile + web identically).

import { randomUUID } from './uuid';

export { randomUUID } from './uuid';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  /** Server's structured payload (Result<T> shape). */
  data: T | { ok: false; code: string; message?: string; details?: unknown };
  /** Convenience flag derived from server payload's `ok` field. */
  success: boolean;
}

export interface ClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null) right before a request fires. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Invoked on 401; callers should refresh + retry once, then sign-out on failure. */
  onUnauthorized?: () => void | Promise<void>;
  /** Override generator (mobile uses random UUID; tests can pass deterministic). */
  idempotencyKeyFactory?: () => string;
  /** Default fetch implementation; tests can inject one. */
  fetchImpl?: typeof fetch;
}

export class KafilApiClient {
  private baseUrl: string;
  private getAccessToken: () => string | null | Promise<string | null>;
  private onUnauthorized: () => void | Promise<void>;
  private newKey: () => string;
  private fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.getAccessToken = opts.getAccessToken ?? (() => null);
    this.onUnauthorized = opts.onUnauthorized ?? (() => {});
    this.newKey = opts.idempotencyKeyFactory ?? (() => randomUUID());
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // ── public helpers ──────────────────────────────────────────────────
  get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown, opts?: { idempotencyKey?: string }): Promise<ApiResult<T>> {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T>(path: string, body: unknown, opts?: { idempotencyKey?: string }): Promise<ApiResult<T>> {
    return this.request<T>('PATCH', path, body, opts);
  }

  // ── core ────────────────────────────────────────────────────────────
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const token = await this.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // §24/A7 — every mutating request carries an Idempotency-Key. Stable per logical
    // intent: callers can pass one in (e.g. from the offline outbox) or we generate.
    if (method !== 'GET') {
      headers['Idempotency-Key'] = opts?.idempotencyKey ?? this.newKey();
    }

    // §13 mobile retry primitive: retry-with-backoff on 5xx and network errors.
    // Keep it small in the client; full outbox is a separate module on mobile.
    const MAX = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        });

        if (res.status === 401) {
          await this.onUnauthorized();
        }

        const data = (await res.json().catch(() => ({}))) as
          | { ok: true }
          | { ok: false; code: string; message?: string };

        // Retry only on transient 5xx; everything else is a final answer.
        if (res.status >= 500 && attempt < MAX - 1) {
          await sleep(150 * 2 ** attempt);
          continue;
        }

        return {
          ok: res.ok,
          status: res.status,
          data: data as T,
          success: (data as { ok: boolean }).ok ?? res.ok,
        };
      } catch (e: unknown) {
        lastErr = e;
        if (attempt < MAX - 1) await sleep(150 * 2 ** attempt);
      }
    }
    return {
      ok: false,
      status: 0,
      data: {
        ok: false,
        code: 'NETWORK',
        message: lastErr instanceof Error ? lastErr.message : 'network error',
      },
      success: false,
    };
  }
}

// ── typed endpoint wrappers — call-site sugar ─────────────────────────
// Keep these small; the client does all the work. Add wrappers as features land.

export interface OtpRequestBody {
  phone_e164: string;
  device_fingerprint: string;
}
export interface OtpVerifyBody extends OtpRequestBody {
  otp: string;
}
export interface SessionScope {
  money?: boolean;
  cooldown_until?: number;
}
export interface VerifyResponse {
  ok: true;
  value: {
    userId: string;
    isNew: boolean;
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    cooldown?: boolean;
  };
}

export class KafilAuth {
  constructor(private c: KafilApiClient) {}
  requestOtp(input: OtpRequestBody) {
    return this.c.post<{ ok: true; value: { sent: true } }>('/api/auth/otp/request', input);
  }
  verifyOtp(input: OtpVerifyBody) {
    return this.c.post<VerifyResponse>('/api/auth/otp/verify', input);
  }
  refresh(refresh_token: string) {
    return this.c.post<{
      ok: true;
      value: { accessToken: string; refreshToken: string };
    }>('/api/auth/refresh', { refresh_token });
  }
  me() {
    return this.c.get<{ ok: true; user: unknown }>('/api/auth/me');
  }
}

// ── helpers ───────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

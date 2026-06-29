// Pluggable rate limiter (§9 abuse controls + audit wave 3).
//
// Fixed-window counter behind an interface. The in-memory implementation is the
// default and is correct for a single instance; in production a Redis-backed
// implementation (same interface) gives cross-instance limits. Swap by setting
// `rateLimiter` once at startup — call sites never change.
//
// Why a service-layer limiter and not just middleware: the OTP brute-force and
// SMS-spam limits must hold no matter how the action is reached (HTTP route, future
// internal call, test). Keeping it in the service keeps the guarantee with the logic.

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  /** Unix ms when the current window resets (for Retry-After / messaging). */
  resetAt: number;
}

export interface RateLimiter {
  /**
   * Count one hit against `key` within a `windowMs` window allowing `max` hits.
   * Returns whether this hit is allowed and how many remain.
   */
  hit(key: string, opts: { max: number; windowMs: number }): Promise<RateDecision>;
  /** Clear a key (e.g. on successful OTP verify, so a fresh login isn't penalized). */
  reset(key: string): Promise<void>;
}

// ── in-memory fixed-window implementation ────────────────────────────────────

interface Window {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  // Opportunistic sweep bookkeeping so the map doesn't grow unbounded.
  private lastSweep = 0;

  async hit(key: string, opts: { max: number; windowMs: number }): Promise<RateDecision> {
    const now = Date.now();
    this.maybeSweep(now);

    const w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      const resetAt = now + opts.windowMs;
      this.windows.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: opts.max - 1, resetAt };
    }

    if (w.count >= opts.max) {
      return { allowed: false, remaining: 0, resetAt: w.resetAt };
    }
    w.count += 1;
    return { allowed: true, remaining: opts.max - w.count, resetAt: w.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  /** Test hook — wipe all state between cases. */
  clear(): void {
    this.windows.clear();
    this.lastSweep = 0;
  }

  private maybeSweep(now: number): void {
    // Sweep at most once a minute; cheap amortized cleanup of expired windows.
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) {
      if (now >= w.resetAt) this.windows.delete(k);
    }
  }
}

// The process-wide limiter. Reassign at startup to a Redis-backed impl in prod.
export const rateLimiter: RateLimiter = new InMemoryRateLimiter();

// Canonical limit policies (one place to tune). Values are conservative defaults.
export const LIMITS = {
  // OTP request: cap SMS sends per phone to curb spam/cost (§11) and harassment.
  otpRequestPerPhone: { max: 5, windowMs: 15 * 60_000 }, // 5 / 15 min
  // OTP verify: cap wrong-code attempts per phone to slow brute force (complements
  // the per-OTP attempt counter, which a re-request would otherwise reset).
  otpVerifyPerPhone: { max: 10, windowMs: 15 * 60_000 }, // 10 / 15 min
} as const;

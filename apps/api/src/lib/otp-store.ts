// OTP store behind an interface (audit wave 3).
//
// The OTP is short-lived secret state keyed by phone. In-memory is the default and
// is correct for a single instance; a Redis-backed implementation (same interface,
// with native TTL) makes OTP verification work across instances in production. Swap
// `otpStore` at startup — auth.service never changes.

export interface OtpEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
}

export interface OtpStore {
  set(phone: string, entry: OtpEntry): Promise<void>;
  get(phone: string): Promise<OtpEntry | undefined>;
  delete(phone: string): Promise<void>;
}

export class InMemoryOtpStore implements OtpStore {
  private readonly map = new Map<string, OtpEntry>();

  async set(phone: string, entry: OtpEntry): Promise<void> {
    this.map.set(phone, entry);
  }

  async get(phone: string): Promise<OtpEntry | undefined> {
    const e = this.map.get(phone);
    // Lazy expiry so a stale entry never resolves.
    if (e && Date.now() > e.expiresAt) {
      this.map.delete(phone);
      return undefined;
    }
    return e;
  }

  async delete(phone: string): Promise<void> {
    this.map.delete(phone);
  }

  /** Test hook. */
  clear(): void {
    this.map.clear();
  }
}

// Process-wide store. Reassign at startup to a Redis-backed impl in prod.
export const otpStore: OtpStore = new InMemoryOtpStore();

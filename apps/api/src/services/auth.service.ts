// Phone-OTP auth (§3 + §26/M6).
// - Anyone with a phone can request an OTP.
// - First-time phone → new user. Returning phone → re-verify in cooldown mode (§24/A1).
// - Verified OTP creates a session (sessions table) and returns access + refresh tokens.

import { randomBytes, createHash, randomInt } from 'node:crypto';
import { RequestOtpInput, VerifyOtpInput, type Lang } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { smsProvider } from '../providers/sms.provider';

// Dev/test OTP store. In production this lives in Redis with a short TTL.
// Process-local map is fine until we add Redis.
const otpStore = new Map<string, { otp: string; expiresAt: number; attempts: number }>();

/**
 * Test-only hook to read the pending OTP for a phone. Production code never imports
 * this; integration tests use it to drive the verify flow without log-scraping.
 */
export function __test_getPendingOtp(phoneE164: string): string | undefined {
  return otpStore.get(phoneE164)?.otp;
}

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

function sixDigit(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const authService = {
  async requestOtp(input: unknown): Promise<Result<{ sent: true }>> {
    const parse = RequestOtpInput.safeParse(input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const otp = sixDigit();
    otpStore.set(parse.data.phone_e164, {
      otp,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });
    await smsProvider.sendOtp(parse.data.phone_e164, otp);

    await emitEvent(prisma, {
      eventType: 'auth.otp_requested',
      refType: 'phone',
      payload: { phone_e164: parse.data.phone_e164 },
    });

    return ok({ sent: true });
  },

  async verifyOtp(input: unknown): Promise<
    Result<{
      userId: string;
      isNew: boolean;
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      cooldown: boolean;
    }>
  > {
    const parse = VerifyOtpInput.safeParse(input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());
    const { phone_e164, otp, device_fingerprint } = parse.data;

    const entry = otpStore.get(phone_e164);
    if (!entry) return err('UNAUTHORIZED', 'no OTP requested');
    if (Date.now() > entry.expiresAt) {
      otpStore.delete(phone_e164);
      return err('UNAUTHORIZED', 'OTP expired');
    }
    entry.attempts += 1;
    if (entry.attempts > OTP_MAX_ATTEMPTS) {
      otpStore.delete(phone_e164);
      return err('UNAUTHORIZED', 'too many attempts');
    }
    if (entry.otp !== otp) return err('UNAUTHORIZED', 'wrong OTP');

    otpStore.delete(phone_e164);

    // Atomic: upsert user, register device, create session, log account_history.
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phoneE164: phone_e164 } });
      const isNew = !existing;

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { phoneVerifiedAt: new Date() },
          })
        : await tx.user.create({
            data: {
              phoneE164: phone_e164,
              displayName: phone_e164, // placeholder — set in onboarding
              preferredLang: 'ps' satisfies Lang,
              phoneVerifiedAt: new Date(),
              accountHistory: { create: { phoneE164: phone_e164, reason: 'initial' } },
            },
          });

      // §24/A1 — re-verifying an existing phone on a new fingerprint enters cooldown mode:
      // session scope `{ money: false }` for first 24h; client must show banner.
      const knownDevice = await tx.device.findFirst({
        where: { userId: user.id, deviceFingerprint: device_fingerprint },
      });
      const cooldown = !isNew && !knownDevice;

      const device = knownDevice
        ? await tx.device.update({
            where: { id: knownDevice.id },
            data: { lastSeenAt: new Date() },
          })
        : await tx.device.create({
            data: {
              userId: user.id,
              deviceFingerprint: device_fingerprint,
              lastSeenAt: new Date(),
            },
          });

      const refreshToken = randomBytes(32).toString('base64url');
      const session = await tx.session.create({
        data: {
          userId: user.id,
          deviceId: device.id,
          refreshTokenHash: hash(refreshToken),
          scope: cooldown ? { money: false, cooldown_until: Date.now() + 24 * 60 * 60_000 } : undefined,
        },
      });

      await emitEvent(tx, {
        eventType: 'auth.session_created',
        actorId: user.id,
        refType: 'session',
        refId: session.id,
        payload: { is_new: isNew, cooldown },
      });

      const accessToken = signAccessToken({ userId: user.id, sessionId: session.id });
      return {
        userId: user.id,
        isNew,
        accessToken,
        refreshToken,
        sessionId: session.id,
        cooldown, // §24/A1 — client must show banner + disable money actions
      };
    });

    return ok(result);
  },

  async resolveAccessToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
    return verifyAccessToken(token);
  },

  /** Refresh: rotate the refresh token. Old token instantly invalidated. */
  async refresh(refreshToken: string): Promise<
    Result<{ accessToken: string; refreshToken: string }>
  > {
    const h = hash(refreshToken);
    const session = await prisma.session.findFirst({
      where: { refreshTokenHash: h, revokedAt: null },
    });
    if (!session) return err('UNAUTHORIZED', 'invalid refresh token');
    if (Date.now() - session.issuedAt.getTime() > REFRESH_TTL_MS) {
      return err('UNAUTHORIZED', 'refresh token expired');
    }
    const newRefresh = randomBytes(32).toString('base64url');
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: hash(newRefresh), lastSeenAt: new Date() },
    });
    return ok({
      accessToken: signAccessToken({ userId: session.userId, sessionId: session.id }),
      refreshToken: newRefresh,
    });
  },

  async revoke(sessionId: string): Promise<Result<{ revoked: true }>> {
    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return ok({ revoked: true });
  },
};

// ── access-token signing (HS256, server-side secret) ───────────────────────────
// Compact JWT-like format; we don't import jsonwebtoken to keep deps lean.
// In prod, swap to a real JWT lib + rotated keys.
import { createHmac, timingSafeEqual } from 'node:crypto';

const ACCESS_TTL_MS = 15 * 60_000;
const SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-DO-NOT-USE-IN-PROD';

function b64(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}

export function signAccessToken(payload: { userId: string; sessionId: string }): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(
    JSON.stringify({ ...payload, exp: Date.now() + ACCESS_TTL_MS, iat: Date.now() }),
  );
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyAccessToken(
  token: string,
): { userId: string; sessionId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      userId: string;
      sessionId: string;
      exp: number;
    };
    if (Date.now() > parsed.exp) return null;
    return { userId: parsed.userId, sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}

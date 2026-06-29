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
import { otpStore } from '../lib/otp-store';
import { rateLimiter, LIMITS } from '../lib/rate-limiter';

/**
 * Test-only hook to read the pending OTP for a phone. Production code never imports
 * this; integration tests use it to drive the verify flow without log-scraping.
 */
export async function __test_getPendingOtp(phoneE164: string): Promise<string | undefined> {
  return (await otpStore.get(phoneE164))?.otp;
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

    // Rate limit per phone — curb SMS spam/cost (§11) and harassment of a target number.
    const rl = await rateLimiter.hit(`otp:req:${parse.data.phone_e164}`, LIMITS.otpRequestPerPhone);
    if (!rl.allowed) {
      return err('RATE_LIMIT', 'Too many OTP requests. Please wait before trying again.');
    }

    const otp = sixDigit();
    await otpStore.set(parse.data.phone_e164, {
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

    // Per-phone verify rate limit — slows brute force even across OTP re-requests
    // (the per-entry attempt counter alone resets every time a new OTP is requested).
    const rl = await rateLimiter.hit(`otp:vfy:${phone_e164}`, LIMITS.otpVerifyPerPhone);
    if (!rl.allowed) {
      return err('RATE_LIMIT', 'Too many verification attempts. Please wait before trying again.');
    }

    const entry = await otpStore.get(phone_e164);
    if (!entry) return err('UNAUTHORIZED', 'no OTP requested');
    if (Date.now() > entry.expiresAt) {
      await otpStore.delete(phone_e164);
      return err('UNAUTHORIZED', 'OTP expired');
    }
    entry.attempts += 1;
    if (entry.attempts > OTP_MAX_ATTEMPTS) {
      await otpStore.delete(phone_e164);
      return err('UNAUTHORIZED', 'too many attempts');
    }
    if (entry.otp !== otp) {
      // Persist the incremented attempt count back to the store (store-agnostic).
      await otpStore.set(phone_e164, entry);
      return err('UNAUTHORIZED', 'wrong OTP');
    }

    await otpStore.delete(phone_e164);
    // Successful verify clears the brute-force window so the next login isn't penalized.
    await rateLimiter.reset(`otp:vfy:${phone_e164}`);

    // §9 — a banned or suspended account can't obtain a session. We surface this as
    // FORBIDDEN before doing any work (returning users only; new signups are 'active').
    const priorUser = await prisma.user.findUnique({
      where: { phoneE164: phone_e164 },
      select: { status: true, statusReason: true },
    });
    if (priorUser && (priorUser.status === 'banned' || priorUser.status === 'suspended')) {
      return err(
        'FORBIDDEN',
        priorUser.status === 'banned'
          ? `Account banned${priorUser.statusReason ? `: ${priorUser.statusReason}` : ''}. Contact support to appeal.`
          : `Account suspended${priorUser.statusReason ? `: ${priorUser.statusReason}` : ''}.`,
      );
    }

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

  /**
   * Refresh: rotate the refresh token. The old token is instantly invalidated.
   *
   * Reuse detection (token theft): if the presented token matches the PREVIOUS
   * (already-rotated-out) hash of a still-live session, that token should be dead —
   * its presence means it was captured and replayed. We revoke the entire session
   * (killing the attacker's freshly-minted token too) and log a security event.
   */
  async refresh(refreshToken: string): Promise<
    Result<{ accessToken: string; refreshToken: string }>
  > {
    const h = hash(refreshToken);

    // Theft path: a live session whose PREVIOUS token is being presented again.
    const reused = await prisma.session.findFirst({
      where: { prevRefreshTokenHash: h, revokedAt: null },
    });
    if (reused) {
      await prisma.session.update({
        where: { id: reused.id },
        data: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' },
      });
      await emitEvent(prisma, {
        eventType: 'auth.refresh_reuse_detected',
        actorId: reused.userId,
        refType: 'session',
        refId: reused.id,
      });
      return err('UNAUTHORIZED', 'refresh token reuse detected — session revoked');
    }

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
      data: {
        // Remember the token we're rotating OUT so a later replay of it is caught.
        prevRefreshTokenHash: session.refreshTokenHash,
        refreshTokenHash: hash(newRefresh),
        lastSeenAt: new Date(),
      },
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
// Pin the algorithm and bind tokens to this service so a token can't be reused on a
// sibling service that shares the secret (iss/aud), and an attacker can't downgrade
// the algorithm (e.g. alg:none / RS256 confusion) by editing the header.
const ALG = 'HS256';
const ISS = 'kafil-api';
const AUD = 'kafil-api';

function b64(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}

export function signAccessToken(payload: { userId: string; sessionId: string }): string {
  const header = b64(JSON.stringify({ alg: ALG, typ: 'JWT' }));
  const body = b64(
    JSON.stringify({
      ...payload,
      iss: ISS,
      aud: AUD,
      exp: Date.now() + ACCESS_TTL_MS,
      iat: Date.now(),
    }),
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

  // Algorithm pinning: the header must declare exactly our HMAC alg. Without this a
  // forged `alg:none` or an RS256-confusion attempt could be accepted if the verify
  // path ever changed. We refuse anything but HS256 up front.
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string };
    if (head.alg !== ALG) return null;
  } catch {
    return null;
  }

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
      iss?: string;
      aud?: string;
    };
    if (Date.now() > parsed.exp) return null;
    if (parsed.iss !== ISS || parsed.aud !== AUD) return null;
    return { userId: parsed.userId, sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}

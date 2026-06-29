import { z } from 'zod';
import { Lang, PhoneE164, Timestamp, Uuid } from './common';

// §2.1 + §3 — single identity, many roles.
export const UserRole = z.enum([
  'worker',
  'employer',
  'shop_owner',
  'admin',
  'moderator',
  'support',
]);
export type UserRole = z.infer<typeof UserRole>;

export const UserStatus = z.enum(['active', 'suspended', 'banned', 'deactivated']);

export const KycLevel = z.number().int().min(0).max(3);

export const User = z.object({
  id: Uuid,
  phone_e164: PhoneE164,
  phone_verified_at: Timestamp.nullable(),
  display_name: z.string().min(1).max(120),
  photo_url: z.string().url().nullable(),
  preferred_lang: Lang,
  status: UserStatus,
  status_reason: z.string().nullable(),
  kyc_level: KycLevel,
  trust_score: z.number().int(),
  created_at: Timestamp,
  version: z.number().int().nonnegative(),
});
export type User = z.infer<typeof User>;

// Onboarding step 1: phone OTP request.
export const RequestOtpInput = z.object({
  phone_e164: PhoneE164,
  // §24/A1: re-verifying an existing phone requires a recovery_secret or step-up.
  // Absent here = first-time signup; presence is checked server-side.
  device_fingerprint: z.string().min(8).max(128),
});

export const VerifyOtpInput = z.object({
  phone_e164: PhoneE164,
  otp: z.string().regex(/^\d{6}$/),
  device_fingerprint: z.string().min(8).max(128),
});

// Adding a role lazily — §3 lets a user become a worker AND employer on the same id.
export const AddRoleInput = z.object({
  role: UserRole,
});

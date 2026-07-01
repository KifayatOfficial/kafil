// User profile + role-management service.
// §3 — lazy role attach (a user can hold multiple roles; new roles add a row, never overwrite).
// All mutations are idempotent: re-adding a role is a no-op; re-applying the same profile
// payload returns the same record without bumping `version` unnecessarily.

import { z } from 'zod';
import { Lang, UserRole } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';

const UpdateProfileInput = z.object({
  display_name: z.string().min(1).max(120).optional(),
  preferred_lang: Lang.optional(),
  photo_url: z.string().url().nullable().optional(),
});
type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

const AddRoleInput = z.object({
  role: UserRole,
});

const UpdateWorkerProfileInput = z.object({
  bio: z.string().max(1000).nullable().optional(),
  experience_years: z.number().int().min(0).max(80).nullable().optional(),
  rate_min_pkr: z.number().int().positive().nullable().optional(),
  rate_max_pkr: z.number().int().positive().nullable().optional(),
  base_location_id: z.string().uuid().nullable().optional(),
  specialty_ids: z.array(z.string().uuid()).max(20).optional(),
});

export const userService = {
  /**
   * GET /api/users/:id — PUBLIC profile. P6: phone/PII is platform-asset, so it is NOT
   * returned here — only the display name, photo, roles, trust/rating, and (if a worker)
   * bio + experience. This is what one user may see about another.
   */
  async getPublicProfile(userId: string): Promise<
    Result<{
      id: string;
      displayName: string;
      photoUrl: string | null;
      status: string;
      trustScore: number;
      kycLevel: number;
      roles: string[];
      workerProfile: { bio: string | null; experienceYears: number | null; rating: number } | null;
    }>
  > {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        photoUrl: true,
        status: true,
        trustScore: true,
        kycLevel: true,
        roles: { select: { role: true } },
        workerProfile: { select: { bio: true, experienceYears: true, ratingBayesian: true } },
      },
    });
    if (!u) return err('NOT_FOUND', 'user not found');
    // Banned/deactivated users aren't shown publicly (T&S — no platform for bad actors).
    if (u.status === 'banned' || u.status === 'deactivated') return err('NOT_FOUND', 'user not found');
    return ok({
      id: u.id,
      displayName: u.displayName,
      photoUrl: u.photoUrl,
      status: u.status,
      trustScore: u.trustScore,
      kycLevel: u.kycLevel,
      roles: u.roles.map((r) => r.role),
      workerProfile: u.workerProfile
        ? {
            bio: u.workerProfile.bio,
            experienceYears: u.workerProfile.experienceYears,
            rating: u.workerProfile.ratingBayesian ? Number(u.workerProfile.ratingBayesian) : 0,
          }
        : null,
    });
  },

  /** PATCH /api/auth/me */
  async updateProfile(args: { userId: string; input: unknown }): Promise<Result<{ updated: true }>> {
    const parse = UpdateProfileInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const data: Record<string, unknown> = {};
    if (parse.data.display_name !== undefined) data.displayName = parse.data.display_name;
    if (parse.data.preferred_lang !== undefined) data.preferredLang = parse.data.preferred_lang;
    if (parse.data.photo_url !== undefined) data.photoUrl = parse.data.photo_url;

    if (Object.keys(data).length === 0) {
      // Idempotent no-op — empty body is fine.
      return ok({ updated: true });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: args.userId },
        data: { ...data, version: { increment: 1 } },
      });
      await emitEvent(tx, {
        eventType: 'user.profile_updated',
        actorId: args.userId,
        refType: 'user',
        refId: args.userId,
        payload: data,
      });
    });
    return ok({ updated: true });
  },

  /** POST /api/auth/me/roles — §3 lazy add. */
  async addRole(args: { userId: string; input: unknown }): Promise<Result<{ added: boolean; role: string }>> {
    const parse = AddRoleInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    // Treat admin/moderator/support attempts via this self-service endpoint as forbidden.
    if (['admin', 'moderator', 'support'].includes(parse.data.role)) {
      return err('FORBIDDEN', 'role cannot be self-assigned');
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.userRole.findUnique({
        where: { userId_role: { userId: args.userId, role: parse.data.role } },
      });
      if (existing) return { added: false, role: parse.data.role };

      await tx.userRole.create({ data: { userId: args.userId, role: parse.data.role } });

      // §3 — create the matching role-profile row lazily.
      if (parse.data.role === 'worker') {
        await tx.workerProfile.upsert({
          where: { userId: args.userId },
          create: { userId: args.userId },
          update: {},
        });
      } else if (parse.data.role === 'employer') {
        await tx.employerProfile.upsert({
          where: { userId: args.userId },
          create: { userId: args.userId },
          update: {},
        });
      }
      await emitEvent(tx, {
        eventType: 'user.role_added',
        actorId: args.userId,
        refType: 'user',
        refId: args.userId,
        payload: { role: parse.data.role },
      });
      return { added: true, role: parse.data.role };
    });
    return ok(result);
  },

  /** PATCH /api/worker-profile — attach specialties + bio + base location. */
  async updateWorkerProfile(args: {
    userId: string;
    input: unknown;
  }): Promise<Result<{ updated: true }>> {
    const parse = UpdateWorkerProfileInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    // The user must already hold the worker role; otherwise return FORBIDDEN
    // (caller can then trigger addRole first — UI flow does this transparently).
    const hasRole = await prisma.userRole.findUnique({
      where: { userId_role: { userId: args.userId, role: 'worker' } },
    });
    if (!hasRole) return err('FORBIDDEN', 'worker role not granted yet');

    const i = parse.data;
    await prisma.$transaction(async (tx) => {
      const fields: Record<string, unknown> = {};
      if (i.bio !== undefined) fields.bio = i.bio;
      if (i.experience_years !== undefined) fields.experienceYears = i.experience_years;
      if (i.rate_min_pkr !== undefined) fields.rateMinPkr = i.rate_min_pkr;
      if (i.rate_max_pkr !== undefined) fields.rateMaxPkr = i.rate_max_pkr;
      if (i.base_location_id !== undefined) fields.baseLocationId = i.base_location_id;

      await tx.workerProfile.upsert({
        where: { userId: args.userId },
        create: { userId: args.userId, ...fields },
        update: fields,
      });

      if (i.specialty_ids) {
        // Replace-style: delete + recreate. Tiny set; simpler than a diff.
        await tx.workerSpecialty.deleteMany({ where: { userId: args.userId } });
        if (i.specialty_ids.length) {
          await tx.workerSpecialty.createMany({
            data: i.specialty_ids.map((sid) => ({ userId: args.userId, specialtyId: sid })),
            skipDuplicates: true,
          });
        }
      }
      await emitEvent(tx, {
        eventType: 'worker_profile.updated',
        actorId: args.userId,
        refType: 'user',
        refId: args.userId,
        payload: { keys: Object.keys(fields), specialties: i.specialty_ids?.length ?? null },
      });
    });
    return ok({ updated: true });
  },
};

// Repository layer (P2): the ONLY layer that talks to the database.
// §10 F7 referral persistence: codes, claims, qualification.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

export const referralRepository = {
  /** The stable code row a referrer shares (referredId null = the shareable template). */
  findShareableByReferrer(referrerId: string) {
    return prisma.referral.findFirst({
      where: { referrerId, referredId: null },
    });
  },

  findByCode(code: string) {
    return prisma.referral.findUnique({ where: { code } });
  },

  create(tx: Prisma.TransactionClient, data: Prisma.ReferralUncheckedCreateInput) {
    return tx.referral.create({ data });
  },

  /** Has this user already been referred by anyone (claimed a code)? One referral per referred user. */
  findClaimByReferred(referredId: string) {
    return prisma.referral.findFirst({ where: { referredId } });
  },

  /** All referrals a user has made (for their dashboard). Newest first. */
  listByReferrer(referrerId: string) {
    return prisma.referral.findMany({
      where: { referrerId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Pending claim awaiting qualification for a specific referred user. */
  findPendingClaimForReferred(referredId: string) {
    return prisma.referral.findFirst({
      where: { referredId, status: 'pending' },
    });
  },

  /** How many referrals this referrer claimed since `since` — velocity cap input (F7). */
  countClaimsSince(referrerId: string, since: Date): Promise<number> {
    return prisma.referral.count({
      where: { referrerId, referredId: { not: null }, createdAt: { gte: since } },
    });
  },

  updateStatus(
    tx: Prisma.TransactionClient,
    id: string,
    data: { status: string; qualifiedByEvent?: string | null; rewardMinor?: number | null },
  ) {
    return tx.referral.update({ where: { id }, data });
  },

  /** Distinct user_ids seen on a device fingerprint — self-referral (same-device) check (F3/F7). */
  async userIdsOnFingerprint(fingerprint: string): Promise<string[]> {
    const rows = await prisma.device.findMany({
      where: { deviceFingerprint: fingerprint, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId).filter((u): u is string => !!u);
  },

  /** The fingerprints a user has signed in from — to compare two users' devices. */
  async fingerprintsForUser(userId: string): Promise<string[]> {
    const rows = await prisma.device.findMany({
      where: { userId, deviceFingerprint: { not: null } },
      select: { deviceFingerprint: true },
      distinct: ['deviceFingerprint'],
    });
    return rows.map((r) => r.deviceFingerprint).filter((f): f is string => !!f);
  },

  /** Count of completed assignments for a worker — "is this their first?" (qualify trigger). */
  countCompletedAssignments(workerId: string): Promise<number> {
    return prisma.assignment.count({
      where: { workerId, status: 'completed' },
    });
  },
};

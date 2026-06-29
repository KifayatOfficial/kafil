// Helpers for writing isolated DB-backed tests against the dev Postgres.
// Each test seeds its OWN rows (uuid-prefixed) and cleans them up at end.

import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db';

export async function makeUser(overrides?: Partial<{ phone: string; role: string; kyc: number }>) {
  const phone = overrides?.phone ?? `+9230${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const role = overrides?.role ?? 'worker';
  const u = await prisma.user.create({
    data: {
      phoneE164: phone,
      displayName: `Test ${role}`,
      preferredLang: 'ps',
      kycLevel: overrides?.kyc ?? 1,
      roles: { create: [{ role }] },
      ...(role === 'worker' ? { workerProfile: { create: {} } } : {}),
      ...(role === 'employer' ? { employerProfile: { create: {} } } : {}),
    },
  });
  return u;
}

export async function makeLocation() {
  return prisma.location.create({
    data: {
      label: 'Test location',
      district: 'Swat',
      tehsil: 'Babuzai',
      lat: 34.78,
      lng: 72.36,
      precision: 'pin',
    },
  });
}

export async function ensureMasonrySpecialty() {
  return prisma.specialty.upsert({
    where: { slug: 'masonry' },
    create: { slug: 'masonry', nameEn: 'Mason', nameUr: 'راج', namePs: 'معمار', icon: 'trowel' },
    update: {},
  });
}

/** Wipe rows created by tests (anything whose phone starts with our test prefix). */
export async function cleanupTestData() {
  // Order matters: respect FKs.
  await prisma.event.deleteMany({}); // events are append-only; clearing keeps test runs predictable
  await prisma.review.deleteMany({}); // reviews FK assignments — must precede
  await prisma.workLog.deleteMany({});
  await prisma.disputeEvidence.deleteMany({});
  await prisma.dispute.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.application.deleteMany({});
  await prisma.jobSlot.deleteMany({});
  await prisma.jobSpecialty.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.accountHistory.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.workerSpecialty.deleteMany({});
  await prisma.workerProfile.deleteMany({});
  await prisma.employerProfile.deleteMany({});
  await prisma.userRole.deleteMany({});
  // Keep seeded demo users + locations; delete anything created by tests (phones outside the 0000...10/20 demo range).
  await prisma.user.deleteMany({
    where: { phoneE164: { not: { in: ['+923000000010', '+923000000020'] } } },
  });
  await prisma.location.deleteMany({
    where: { id: { not: '00000000-0000-0000-0000-000000000001' } },
  });
}

export const newKey = () => `test-${randomUUID()}`;

// Tests for the user/profile/role endpoints used in onboarding.
//
// Invariants:
// 1. updateProfile is idempotent (empty body is a no-op; same payload twice is fine).
// 2. addRole is idempotent (added=true first call, added=false second).
// 3. addRole refuses admin/moderator/support self-assignment (FORBIDDEN).
// 4. updateWorkerProfile fails FORBIDDEN if the worker role isn't held yet.
// 5. updateWorkerProfile attaches specialties; re-running replaces the set.
// 6. verifyOtp returns `cooldown: false` on first-time-this-device for an existing user,
//    `cooldown: true` on unfamiliar device (§24/A1).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { authService, __test_getPendingOtp } from '../auth.service';
import { userService } from '../user.service';
import {
  cleanupTestData,
  ensureMasonrySpecialty,
  makeUser,
} from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('userService.updateProfile', () => {
  it('is idempotent on empty body and applies fields when given', async () => {
    const u = await makeUser({ role: 'worker' });

    const empty = await userService.updateProfile({ userId: u.id, input: {} });
    expect(empty.ok).toBe(true);

    const set = await userService.updateProfile({
      userId: u.id,
      input: { display_name: 'Abdul Karim', preferred_lang: 'ur' },
    });
    expect(set.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.displayName).toBe('Abdul Karim');
    expect(after.preferredLang).toBe('ur');
  });
});

describe('userService.addRole — §3 lazy add', () => {
  it('first call adds, second call returns added=false (idempotent)', async () => {
    const u = await makeUser({ role: 'worker' }); // already has worker

    const first = await userService.addRole({ userId: u.id, input: { role: 'employer' } });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.added).toBe(true);

    const second = await userService.addRole({ userId: u.id, input: { role: 'employer' } });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.added).toBe(false);

    const roles = await prisma.userRole.findMany({ where: { userId: u.id } });
    expect(roles.map((r) => r.role).sort()).toEqual(['employer', 'worker']);

    // The employer_profiles row should also exist.
    const ep = await prisma.employerProfile.findUnique({ where: { userId: u.id } });
    expect(ep).not.toBeNull();
  });

  it('refuses admin / moderator / support self-assignment', async () => {
    const u = await makeUser({ role: 'worker' });
    for (const role of ['admin', 'moderator', 'support'] as const) {
      const res = await userService.addRole({ userId: u.id, input: { role } });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('FORBIDDEN');
    }
  });
});

describe('userService.updateWorkerProfile', () => {
  it('fails FORBIDDEN when worker role not yet attached', async () => {
    const u = await makeUser({ role: 'employer' }); // not a worker
    const res = await userService.updateWorkerProfile({
      userId: u.id,
      input: { bio: 'hello' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('FORBIDDEN');
  });

  it('attaches specialties and replaces them on re-run', async () => {
    const u = await makeUser({ role: 'worker' });
    const masonry = await ensureMasonrySpecialty();
    const carpenter = await prisma.specialty.upsert({
      where: { slug: 'carpenter' },
      create: { slug: 'carpenter', nameEn: 'Carpenter' },
      update: {},
    });

    const r1 = await userService.updateWorkerProfile({
      userId: u.id,
      input: { bio: 'mason', specialty_ids: [masonry.id] },
    });
    expect(r1.ok).toBe(true);

    let attached = await prisma.workerSpecialty.findMany({ where: { userId: u.id } });
    expect(attached.map((a) => a.specialtyId)).toEqual([masonry.id]);

    const r2 = await userService.updateWorkerProfile({
      userId: u.id,
      input: { specialty_ids: [carpenter.id] },
    });
    expect(r2.ok).toBe(true);

    attached = await prisma.workerSpecialty.findMany({ where: { userId: u.id } });
    expect(attached.map((a) => a.specialtyId)).toEqual([carpenter.id]);
  });
});

describe('authService.verifyOtp — §24/A1 cooldown signal', () => {
  it('first-time signup on a fresh device returns cooldown=false (new user is always trusted)', async () => {
    const phone = `+923009${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'fp-new-001' });
    const otp = await __test_getPendingOtp(phone);
    expect(otp).toBeTypeOf('string');

    const v = await authService.verifyOtp({ phone_e164: phone, otp: otp!, device_fingerprint: 'fp-new-001' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.isNew).toBe(true);
      expect(v.value.cooldown).toBe(false); // brand-new user, no prior bindings
    }
  });

  it('existing user verifying on an UNFAMILIAR device returns cooldown=true', async () => {
    const phone = `+923009${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

    // First verify (creates the user with fingerprint fp-A).
    await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'fp-known-A1' });
    const otp1 = await __test_getPendingOtp(phone);
    const first = await authService.verifyOtp({ phone_e164: phone, otp: otp1!, device_fingerprint: 'fp-known-A1' });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.cooldown).toBe(false);

    // Same phone, NEW device fingerprint → §24/A1 unfamiliar-device cooldown fires.
    await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'fp-unfamiliar-B1' });
    const otp2 = await __test_getPendingOtp(phone);
    const second = await authService.verifyOtp({ phone_e164: phone, otp: otp2!, device_fingerprint: 'fp-unfamiliar-B1' });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.isNew).toBe(false);
      expect(second.value.cooldown).toBe(true);
    }

    // The session row for the unfamiliar-device login carries scope.money:false.
    if (second.ok) {
      const session = await prisma.session.findUniqueOrThrow({
        where: { id: second.value.sessionId },
      });
      const scope = session.scope as { money?: boolean; cooldown_until?: number } | null;
      expect(scope?.money).toBe(false);
      expect(typeof scope?.cooldown_until).toBe('number');
    }
  });

  it('returning user verifying on a KNOWN device returns cooldown=false', async () => {
    const phone = `+923009${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

    // First verify with fp-A.
    await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'fp-known-A1' });
    let otp = await __test_getPendingOtp(phone);
    await authService.verifyOtp({ phone_e164: phone, otp: otp!, device_fingerprint: 'fp-known-A1' });

    // Second verify with the SAME fp-A — known device, no cooldown.
    await authService.requestOtp({ phone_e164: phone, device_fingerprint: 'fp-known-A1' });
    otp = await __test_getPendingOtp(phone);
    const v = await authService.verifyOtp({ phone_e164: phone, otp: otp!, device_fingerprint: 'fp-known-A1' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.cooldown).toBe(false);
  });
});

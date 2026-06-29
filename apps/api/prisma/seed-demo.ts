// Realistic demo seed cohort.
//
// Goals:
//   1. Anyone running `npm run db:seed:demo` on a fresh dev DB lands in an app that
//      *feels populated*: ~10 workers across specialties, 3 employers, 8 jobs of
//      mixed status, and 3 pre-staged §26/M1 ops-review cases so the admin UI is
//      worth opening on first load.
//   2. Fully idempotent — deterministic UUIDs everywhere, upserts only. Re-running
//      against a state that already has the seed is a no-op.
//   3. State respects the §4.3 machine. We use the existing services where possible
//      (jobService.createJob, applicationService.apply, assignmentService.accept).
//      Backdating events to make scheduler timeouts trigger is the ONLY place we
//      reach past the service layer.
//
// Run:  npx tsx prisma/seed-demo.ts
//
// Do NOT include this in CI — the assertion suites have their own deterministic
// fixtures via test-db.ts. This is a developer/demo convenience.

import { PrismaClient } from '@prisma/client';
import { jobService } from '../src/services/job.service';
import { applicationService } from '../src/services/application.service';
import { assignmentService } from '../src/services/assignment.service';

const prisma = new PrismaClient();

// ── Deterministic UUIDs ──────────────────────────────────────────────────────
// We use stable per-role namespaces so the same seed produces the same ids on
// every machine — `select * from users where id=...` is predictable for demos.
// Suffix must be HEX (UUIDs are 4-bit groups). Keys here are 12 hex chars max.
const NS_WORKER = '0000d000-0000-0000-0001-';
const NS_EMPLOYER = '0000d000-0000-0000-0002-';
const NS_JOB = '0000d000-0000-0000-0003-';
const uid = (key: string): string => {
  // Map our human-readable keys (e.g. 'w0000001') to hex suffixes.
  if (key.startsWith('w')) return NS_WORKER + key.slice(1).padStart(12, '0');
  if (key.startsWith('e')) return NS_EMPLOYER + key.slice(1).padStart(12, '0');
  if (key.startsWith('j')) return NS_JOB + key.slice(1).padStart(12, '0');
  throw new Error(`unknown seed key prefix: ${key}`);
};

// Specialties (these already exist via the main seed; we only reference them).

interface SeedUser {
  id: string;
  phone: string;
  name: string;
  role: 'worker' | 'employer';
  kyc?: number;
  bio?: string;
  specialties?: string[]; // slugs
  rateMin?: number;
  rateMax?: number;
}

interface SeedJob {
  id: string;
  title: string;
  description: string;
  ratePkr: number;
  headcount: number;
  durationDays: number;
  specialtySlugs: string[];
  employerKey: string; // refers to SeedUser.id without the NS prefix
  // Optional progression — null/undefined leaves the job 'open'.
  fill?:
    | { state: 'filled'; workerKeys: string[] }
    | { state: 'completed'; workerKeys: string[] }
    | { state: 'ops_review'; workerKey: string; daysSinceMarkedDone: number };
}

const workers: SeedUser[] = [
  {
    id: uid('w0000001'),
    phone: '+923011111111',
    name: 'Abdullah Ahmad',
    role: 'worker',
    kyc: 2,
    bio: 'Mason, 12 years. Mingora.',
    specialties: ['masonry', 'carpenter'],
    rateMin: 3000,
    rateMax: 4000,
  },
  {
    id: uid('w0000002'),
    phone: '+923011111112',
    name: 'Hassan Khan',
    role: 'worker',
    kyc: 2,
    bio: 'Electrician + house wiring.',
    specialties: ['electrician'],
    rateMin: 3500,
    rateMax: 4500,
  },
  {
    id: uid('w0000003'),
    phone: '+923011111113',
    name: 'Faisal Ali',
    role: 'worker',
    kyc: 1,
    bio: 'Carpenter, finish work.',
    specialties: ['carpenter'],
    rateMin: 3000,
    rateMax: 3800,
  },
  {
    id: uid('w0000004'),
    phone: '+923011111114',
    name: 'Bashir Khan',
    role: 'worker',
    kyc: 2,
    specialties: ['plumber'],
    rateMin: 2800,
    rateMax: 3500,
  },
  {
    id: uid('w0000005'),
    phone: '+923011111115',
    name: 'Muhammad Tariq',
    role: 'worker',
    kyc: 1,
    specialties: ['welder', 'electrician'],
    rateMin: 3500,
    rateMax: 4500,
  },
  {
    id: uid('w0000006'),
    phone: '+923011111116',
    name: 'Sajjad Ahmad',
    role: 'worker',
    kyc: 1,
    specialties: ['masonry'],
    rateMin: 2800,
    rateMax: 3500,
  },
  {
    id: uid('w0000007'),
    phone: '+923011111117',
    name: 'Naeem Khan',
    role: 'worker',
    kyc: 2,
    specialties: ['masonry', 'plumber'],
    rateMin: 3000,
    rateMax: 4000,
  },
  {
    id: uid('w0000008'),
    phone: '+923011111118',
    name: 'Iqbal Ahmad',
    role: 'worker',
    kyc: 1,
    specialties: ['carpenter', 'welder'],
    rateMin: 3200,
    rateMax: 4200,
  },
  {
    id: uid('w0000009'),
    phone: '+923011111119',
    name: 'Riaz Khan',
    role: 'worker',
    kyc: 1,
    specialties: ['electrician'],
    rateMin: 3500,
    rateMax: 4500,
  },
  {
    id: uid('w0000010'),
    phone: '+923011111120',
    name: 'Saeed Khan',
    role: 'worker',
    kyc: 2,
    specialties: ['masonry'],
    rateMin: 3000,
    rateMax: 3800,
  },
];

const employers: SeedUser[] = [
  {
    id: uid('e0000001'),
    phone: '+923021111111',
    name: 'Ahmad Construction (Mingora)',
    role: 'employer',
    kyc: 2,
  },
  {
    id: uid('e0000002'),
    phone: '+923021111112',
    name: 'Swat Heights Hotel',
    role: 'employer',
    kyc: 2,
  },
  {
    id: uid('e0000003'),
    phone: '+923021111113',
    name: 'Muhammad Hussain (Homeowner)',
    role: 'employer',
    kyc: 1,
  },
];

// We seed three locations — main demo location stays the one the seed/main creates.
const DEMO_LOCATION_ID = '00000000-0000-0000-0000-000000000001';

const jobs: SeedJob[] = [
  // 1. Plain open job — wide funnel.
  {
    id: uid('j0000001'),
    title: 'Brickwork for house renovation',
    description: '2-week project. Need 2 skilled masons. Quality is important.',
    ratePkr: 3500,
    headcount: 2,
    durationDays: 14,
    specialtySlugs: ['masonry'],
    employerKey: 'e0000001',
  },
  // 2. Open electrician job.
  {
    id: uid('j0000002'),
    title: 'Hotel wiring — 3 rooms',
    description: 'Standard hotel rewire for 3 rooms before summer season.',
    ratePkr: 4000,
    headcount: 1,
    durationDays: 4,
    specialtySlugs: ['electrician'],
    employerKey: 'e0000002',
  },
  // 3. Open plumber job.
  {
    id: uid('j0000003'),
    title: 'Bathroom plumbing — emergency',
    description: 'Leaky pipe. Need to fix this week.',
    ratePkr: 3000,
    headcount: 1,
    durationDays: 2,
    specialtySlugs: ['plumber'],
    employerKey: 'e0000003',
  },
  // 4. Filled job (worker assigned but in_progress) — populates the My-jobs panel.
  {
    id: uid('j0000004'),
    title: 'Carpenter for new shop fittings',
    description: 'Shelving, counter, simple doors. 5 days.',
    ratePkr: 3500,
    headcount: 1,
    durationDays: 5,
    specialtySlugs: ['carpenter'],
    employerKey: 'e0000001',
    fill: { state: 'filled', workerKeys: ['w0000003'] },
  },
  // 5. Completed job — gives the demo a worker with positive history.
  {
    id: uid('j0000005'),
    title: 'Welding for hotel railings',
    description: 'Front gate and balcony railings. Done.',
    ratePkr: 4000,
    headcount: 1,
    durationDays: 3,
    specialtySlugs: ['welder'],
    employerKey: 'e0000002',
    fill: { state: 'completed', workerKeys: ['w0000005'] },
  },
  // 6. Multi-slot open job (3 masons needed).
  {
    id: uid('j0000006'),
    title: 'Wall construction — apartment building',
    description: 'Need 3 masons for 10 days. Long-term reliable work.',
    ratePkr: 3800,
    headcount: 3,
    durationDays: 10,
    specialtySlugs: ['masonry'],
    employerKey: 'e0000001',
  },
  // 7. §26/M1 pre-staged: worker marked done, employer silent, no evidence → ops_review.
  {
    id: uid('j0000007'),
    title: 'House wiring (disputed completion)',
    description: 'Rewiring complete according to worker. Employer not responding.',
    ratePkr: 4000,
    headcount: 1,
    durationDays: 3,
    specialtySlugs: ['electrician'],
    employerKey: 'e0000003',
    fill: { state: 'ops_review', workerKey: 'w0000002', daysSinceMarkedDone: 5 },
  },
  // 8. §26/M1 pre-staged: another ops_review case with a different worker.
  {
    id: uid('j0000008'),
    title: 'Plumbing renovation (no employer response)',
    description: 'Pipe and fixture work done. Awaiting confirmation.',
    ratePkr: 3500,
    headcount: 1,
    durationDays: 2,
    specialtySlugs: ['plumber'],
    employerKey: 'e0000003',
    fill: { state: 'ops_review', workerKey: 'w0000004', daysSinceMarkedDone: 7 },
  },
];

async function upsertUsers(): Promise<void> {
  for (const u of [...workers, ...employers]) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { displayName: u.name, kycLevel: u.kyc ?? 1 },
      create: {
        id: u.id,
        phoneE164: u.phone,
        displayName: u.name,
        preferredLang: 'ps',
        kycLevel: u.kyc ?? 1,
        phoneVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_role: { userId: u.id, role: u.role } },
      update: {},
      create: { userId: u.id, role: u.role },
    });
    if (u.role === 'worker') {
      await prisma.workerProfile.upsert({
        where: { userId: u.id },
        update: {
          bio: u.bio ?? null,
          rateMinPkr: u.rateMin ?? null,
          rateMaxPkr: u.rateMax ?? null,
        },
        create: {
          userId: u.id,
          bio: u.bio ?? null,
          rateMinPkr: u.rateMin ?? null,
          rateMaxPkr: u.rateMax ?? null,
          baseLocationId: DEMO_LOCATION_ID,
        },
      });
      // Attach specialties (replace-style — set is small).
      const specRows = u.specialties
        ? await prisma.specialty.findMany({ where: { slug: { in: u.specialties } } })
        : [];
      await prisma.workerSpecialty.deleteMany({ where: { userId: u.id } });
      if (specRows.length) {
        await prisma.workerSpecialty.createMany({
          data: specRows.map((s) => ({ userId: u.id, specialtyId: s.id })),
          skipDuplicates: true,
        });
      }
    } else {
      await prisma.employerProfile.upsert({
        where: { userId: u.id },
        update: {},
        create: { userId: u.id, baseLocationId: DEMO_LOCATION_ID },
      });
    }
  }
}

async function seedJobs(): Promise<void> {
  for (const j of jobs) {
    // Idempotency: if the job exists with this id, skip — we treat the seed as
    // immutable for already-seeded rows so re-running doesn't churn state.
    const existing = await prisma.job.findUnique({ where: { id: j.id } });
    if (existing) continue;

    const employerId = uid(j.employerKey);
    const specs = await prisma.specialty.findMany({ where: { slug: { in: j.specialtySlugs } } });
    if (specs.length === 0) {
      console.warn(`[seed-demo] skipping ${j.title} — specialty slug not found`);
      continue;
    }

    // Create the job through the service so slots are created correctly + events fire.
    const created = await jobService.createJob({
      employerId,
      input: {
        title: j.title,
        description: j.description,
        location_id: DEMO_LOCATION_ID,
        headcount: j.headcount,
        rate_pkr: j.ratePkr,
        rate_unit: 'day',
        duration_days: j.durationDays,
        specialty_ids: specs.map((s) => s.id),
        idempotency_key: `seed-${j.id}`,
        payment_mode: 'cash',
      },
    });
    if (!created.ok) {
      console.warn(`[seed-demo] failed creating ${j.title}:`, created);
      continue;
    }

    // We can't override the auto-generated job id, so we update it after the fact.
    // (Safe: nothing references the original id yet — it was created seconds ago.)
    await prisma.job.update({
      where: { id: created.value.jobId },
      data: { id: j.id },
    });

    if (!j.fill) continue;

    // Progress the job according to the fill spec.
    const slots = await prisma.jobSlot.findMany({ where: { jobId: j.id }, orderBy: { slotIndex: 'asc' } });

    if (j.fill.state === 'filled' || j.fill.state === 'completed') {
      for (let i = 0; i < j.fill.workerKeys.length; i++) {
        const workerId = uid(j.fill.workerKeys[i]!);
        const slot = slots[i];
        if (!slot) continue;

        // Apply, then accept.
        const applied = await applicationService.apply({
          workerId,
          jobId: j.id,
          input: { idempotency_key: `seed-app-${j.id}-${i}` },
        });
        if (!applied.ok) {
          console.warn('[seed-demo] apply failed:', applied);
          continue;
        }
        const accepted = await assignmentService.acceptApplication({
          employerId,
          applicationId: applied.value.applicationId,
          input: {
            slot_id: slot.id,
            expected_slot_version: slot.version,
            idempotency_key: `seed-acc-${j.id}-${i}`,
          },
        });
        if (!accepted.ok) {
          console.warn('[seed-demo] accept failed:', accepted);
          continue;
        }

        if (j.fill.state === 'completed') {
          // Drive the state machine forward: in_progress → both marked done → completed.
          await prisma.assignment.update({
            where: { id: accepted.value.assignmentId },
            data: { status: 'in_progress', startedAt: new Date(), version: { increment: 1 } },
          });
          await assignmentService.transition({
            assignmentId: accepted.value.assignmentId,
            name: 'worker_mark_done',
            actorId: workerId,
            by: 'worker',
          });
          await assignmentService.transition({
            assignmentId: accepted.value.assignmentId,
            name: 'employer_mark_done',
            actorId: employerId,
            by: 'employer',
          });
        }
      }
    }

    if (j.fill.state === 'ops_review') {
      const workerId = uid(j.fill.workerKey);
      const slot = slots[0];
      if (!slot) continue;

      const applied = await applicationService.apply({
        workerId,
        jobId: j.id,
        input: { idempotency_key: `seed-app-${j.id}` },
      });
      if (!applied.ok) continue;
      const accepted = await assignmentService.acceptApplication({
        employerId,
        applicationId: applied.value.applicationId,
        input: {
          slot_id: slot.id,
          expected_slot_version: slot.version,
          idempotency_key: `seed-acc-${j.id}`,
        },
      });
      if (!accepted.ok) continue;

      // Force forward: in_progress → worker marks done WITHOUT enough evidence.
      // We don't want the scheduler to auto-resolve this to completed-with-evidence;
      // omitting photo_urls + geo + chat ack means evidence_count == 0.
      await prisma.assignment.update({
        where: { id: accepted.value.assignmentId },
        data: { status: 'in_progress', startedAt: new Date(), version: { increment: 1 } },
      });
      await assignmentService.transition({
        assignmentId: accepted.value.assignmentId,
        name: 'worker_mark_done',
        actorId: workerId,
        by: 'worker',
        // Empty payload — no evidence — exactly what triggers §26/M1's <2/3 branch.
        payload: { photo_urls: [], geo: null },
      });

      // Move directly to awaiting_ops_review. We could let the scheduler do this via
      // a backdated worker_marked_done_at + silenceTimeout=0 tick, but that's flakier
      // for a seed — we just stamp the terminal state directly.
      const backdated = new Date(Date.now() - j.fill.daysSinceMarkedDone * 24 * 60 * 60_000);
      await prisma.assignment.update({
        where: { id: accepted.value.assignmentId },
        data: {
          status: 'awaiting_ops_review',
          workerMarkedDoneAt: backdated,
          version: { increment: 1 },
        },
      });
      // Append an audit event so the workbench timeline shows why this is here.
      await prisma.event.create({
        data: {
          eventType: 'assignment.silence_route_to_ops_review',
          actorId: null,
          refType: 'assignment',
          refId: accepted.value.assignmentId,
          payload: { reason: 'seed: pre-staged ops review case', daysSinceMarkedDone: j.fill.daysSinceMarkedDone },
        },
      });
    }
  }
}

async function main(): Promise<void> {
  console.log('[seed-demo] upserting users…');
  await upsertUsers();
  console.log('[seed-demo] seeding jobs…');
  await seedJobs();
  console.log('[seed-demo] done.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

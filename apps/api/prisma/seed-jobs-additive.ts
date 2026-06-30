// Additive job seeder — NON-DESTRUCTIVE. Reuses the employer + location created by the
// base `db:seed` and inserts a spread of `open` jobs so the feed (web + mobile) has real
// content to render. Safe to re-run: it skips titles that already exist.
//
//   cd apps/api && set -a && . ./.env.local && set +a && npx tsx prisma/seed-jobs-additive.ts
//
// This does NOT reset or delete anything. It only inserts jobs that aren't already present.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface JobSeed {
  title: string;
  description: string;
  ratePkr: number;
  rateUnit: string;
  headcount: number;
  durationDays: number;
  featured?: boolean;
}

const JOBS: JobSeed[] = [
  { title: 'Brickwork for house renovation', description: '2-week project. Need 2 skilled masons. Quality is important.', ratePkr: 3500, rateUnit: 'day', headcount: 2, durationDays: 14, featured: true },
  { title: 'Hotel wiring — 3 rooms', description: 'Standard hotel rewire for 3 rooms before summer season.', ratePkr: 4000, rateUnit: 'day', headcount: 1, durationDays: 4 },
  { title: 'Bathroom plumbing — emergency', description: 'Leaky pipe. Need to fix this week. Urgent.', ratePkr: 3000, rateUnit: 'day', headcount: 1, durationDays: 1, featured: true },
  { title: 'Carpenter for new shop fittings', description: 'Shelving, counter, simple doors. 5 days work.', ratePkr: 3500, rateUnit: 'day', headcount: 1, durationDays: 5 },
  { title: 'Welding for hotel railings', description: 'Front gate and balcony railings. Materials provided.', ratePkr: 4000, rateUnit: 'day', headcount: 1, durationDays: 3 },
  { title: 'Wall construction — apartment building', description: 'Need 3 masons for 10 days. Long-term reliable work.', ratePkr: 3800, rateUnit: 'day', headcount: 3, durationDays: 10 },
  { title: 'House painting — 2 floors', description: 'Interior + exterior. Paint supplied. Clean finish needed.', ratePkr: 2800, rateUnit: 'day', headcount: 2, durationDays: 6 },
  { title: 'Tile laying — kitchen & bath', description: 'Porcelain tiles, ~40 sqm. Precision work.', ratePkr: 3200, rateUnit: 'day', headcount: 1, durationDays: 3 },
];

// The base seed's demo employer (see prisma/seed.ts). We target it explicitly and
// ensure its role + profile exist, so this script works even if earlier seed runs left
// roles/profiles partially created. All ops are upsert/create — never destructive.
const EMPLOYER_ID = '00000000-0000-0000-0000-000000000010';

async function main() {
  const employer = await prisma.user.findUnique({ where: { id: EMPLOYER_ID } });
  if (!employer) throw new Error('Demo employer not found — run `npm run db:seed` first.');
  const employerId = employer.id;

  const location = await prisma.location.findFirst({ orderBy: { id: 'asc' } });
  if (!location) throw new Error('No location found — run `npm run db:seed` first.');

  // Idempotently ensure the employer role + profile exist (a job's FK needs the user; the
  // service-level posting flow needs the role). Upsert = safe to re-run.
  await prisma.userRole.upsert({
    where: { userId_role: { userId: employerId, role: 'employer' } },
    create: { userId: employerId, role: 'employer' },
    update: {},
  });
  await prisma.employerProfile.upsert({
    where: { userId: employerId },
    create: { userId: employerId, baseLocationId: location.id },
    update: {},
  });

  const now = Date.now();
  let created = 0;
  let skipped = 0;

  for (const j of JOBS) {
    const exists = await prisma.job.findFirst({ where: { title: j.title } });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.job.create({
      data: {
        employerId,
        locationId: location.id,
        title: j.title,
        description: j.description,
        headcount: j.headcount,
        ratePkr: j.ratePkr,
        rateUnit: j.rateUnit,
        durationDays: j.durationDays,
        status: 'open',
        paymentMode: 'cash',
        // Expire a month out so they stay visible.
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        featuredUntil: j.featured ? new Date(now + 7 * 24 * 60 * 60 * 1000) : null,
      },
    });
    created++;
  }

  console.log(`additive job seed: ${created} created, ${skipped} already present.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

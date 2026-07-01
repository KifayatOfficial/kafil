// Additive seeder for the SHOPS + COMMUNITY pillars — NON-DESTRUCTIVE. Mirrors
// seed-jobs-additive.ts: reuses the demo users, ensures a location, and inserts shops,
// groups, and posts so every pillar (not just jobs) renders real content. Idempotent —
// skips rows whose natural key already exists. Never resets the DB.
//
//   cd apps/api && set -a && . ./.env.local && set +a && npx tsx prisma/seed-community-additive.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMPLOYER_ID = '00000000-0000-0000-0000-000000000010'; // shop owner
const WORKER_ID = '00000000-0000-0000-0000-000000000020'; // group creator/member

const SHOPS = [
  { name: "Hassan's Cement & Materials", description: 'Cement, rebar, sand, tiles. Bulk discounts for contractors.', categories: ['cement', 'tiles', 'hardware'], tier: 'verified' },
  { name: 'Swat Electricals', description: 'Wiring, switchgear, lighting. Trade prices.', categories: ['electrical'], tier: 'free' },
  { name: 'Mingora Timber & Doors', description: 'Seasoned wood, ready doors, custom carpentry.', categories: ['wood', 'carpentry'], tier: 'free' },
  { name: 'Frontier Paints', description: 'Interior + exterior paints, waterproofing.', categories: ['paint'], tier: 'featured' },
];

const GROUPS = [
  { name: 'Mingora Jobs', category: 'geographic', description: 'All daily-wage and project work around Mingora.' },
  { name: 'Masons of Swat', category: 'trade', description: 'Brick, block, plaster — connect and share work.' },
  { name: 'Electricians KP', category: 'trade', description: 'Wiring jobs, tools, and know-how.' },
  { name: 'Apple Orchards & Farming', category: 'interest', description: 'Seasonal labor, tips, and buyers.' },
];

const POSTS = [
  { kind: 'announcement', body: 'Water supply maintenance Thursday 9am–1pm in Mingora bazaar. Plan accordingly.' },
  { kind: 'offer', body: 'Selling 20 units of used scaffolding, good condition. 4000 PKR/unit.' },
  { kind: 'request', body: 'Need 2 masons for a 3-day boundary wall in Saidu Sharif. Fair daily rate.' },
  { kind: 'discussion', body: 'Cement prices went up again this week — anyone getting better bulk rates?' },
];

async function main() {
  const employer = await prisma.user.findUnique({ where: { id: EMPLOYER_ID } });
  const worker = await prisma.user.findUnique({ where: { id: WORKER_ID } });
  if (!employer || !worker) throw new Error('Demo users missing — run `npm run db:seed` first.');

  let location = await prisma.location.findFirst({ orderBy: { id: 'asc' } });
  if (!location) {
    location = await prisma.location.create({
      data: { label: 'Mingora Bazaar', district: 'Swat', tehsil: 'Babuzai', lat: 34.7795, lng: 72.3614, precision: 'landmark' },
    });
  }

  // Ensure the worker holds a worker role (group creator just needs to be a real user).
  await prisma.userRole.upsert({
    where: { userId_role: { userId: WORKER_ID, role: 'worker' } },
    create: { userId: WORKER_ID, role: 'worker' },
    update: {},
  });

  let shopsCreated = 0;
  for (const s of SHOPS) {
    if (await prisma.shop.findFirst({ where: { name: s.name } })) continue;
    await prisma.shop.create({
      data: {
        ownerId: EMPLOYER_ID,
        name: s.name,
        description: s.description,
        locationId: location.id,
        categories: s.categories,
        photos: [],
        verifiedTier: s.tier,
        status: 'active',
        ratingBayesian: 4 + Math.round((s.name.length % 10)) / 10, // deterministic 4.x, no RNG
      },
    });
    shopsCreated++;
  }

  let groupsCreated = 0;
  let postsCreated = 0;
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi]!;
    let group = await prisma.group.findFirst({ where: { name: g.name } });
    if (!group) {
      group = await prisma.group.create({
        data: { name: g.name, category: g.category, description: g.description, createdBy: WORKER_ID, locationId: location.id, status: 'active' },
      });
      // Creator joins as admin.
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: WORKER_ID } },
        create: { groupId: group.id, userId: WORKER_ID, role: 'admin' },
        update: {},
      });
      groupsCreated++;
    }
    // One post per group (matched by index), if the group has none yet.
    const existingPosts = await prisma.post.count({ where: { groupId: group.id } });
    if (existingPosts === 0) {
      const p = POSTS[gi % POSTS.length]!;
      await prisma.post.create({
        data: { groupId: group.id, authorId: WORKER_ID, kind: p.kind, body: p.body, images: [], status: 'visible' },
      });
      postsCreated++;
    }
  }

  console.log(`additive community seed: ${shopsCreated} shops, ${groupsCreated} groups, ${postsCreated} posts created.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

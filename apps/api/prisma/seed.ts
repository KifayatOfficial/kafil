// Minimal seed so the API has something to show. Real concierge seeds come later (§15).
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Specialties — the controlled vocabulary (§2.1).
  const specs = [
    { slug: 'masonry', name_en: 'Mason', name_ur: 'راج', name_ps: 'معمار', icon: 'trowel' },
    { slug: 'electrician', name_en: 'Electrician', name_ur: 'الیکٹریشن', name_ps: 'بریښنا کار', icon: 'bolt' },
    { slug: 'carpenter', name_en: 'Carpenter', name_ur: 'بڑھئی', name_ps: 'نجار', icon: 'saw' },
    { slug: 'plumber', name_en: 'Plumber', name_ur: 'پلمبر', name_ps: 'پلمبر', icon: 'pipe' },
    { slug: 'welder', name_en: 'Welder', name_ur: 'ویلڈر', name_ps: 'جوش کار', icon: 'spark' },
  ];
  for (const s of specs) {
    await prisma.specialty.upsert({
      where: { slug: s.slug },
      create: { slug: s.slug, nameEn: s.name_en, nameUr: s.name_ur, namePs: s.name_ps, icon: s.icon },
      update: {},
    });
  }

  // §6.1 — provisional settings.
  const settings: Array<{ key: string; value: unknown; description: string }> = [
    { key: 'commission.escrow.pct', value: 5, description: '% commission on escrow jobs' },
    { key: 'commission.escrow.minimum_minor', value: 5000, description: '50 PKR floor' },
    { key: 'commission.escrow.cap_minor', value: 2_000_000, description: '20k PKR cap' },
    { key: 'cash.featured_post.pkr', value: 150, description: 'employer-side pay to feature a job' },
    { key: 'cash.applicant_unlock.pkr', value: 50, description: 'connection fee at accept-time' },
    { key: 'verification.shop_tier.monthly_pkr', value: 500, description: '' },
    { key: 'verification.worker_pro.monthly_pkr', value: 200, description: '' },
    { key: 'guarantee.fee.pct', value: 2, description: 'opt-in KAFIL Guarantee' },
    { key: 'referral.reward_minor', value: 30000, description: '300 PKR per qualifying referral' },
    { key: 'hold.low_risk_minutes', value: 0, description: '§6.2 merged rule' },
    { key: 'hold.medium_risk_minutes', value: 1440, description: '24h' },
    { key: 'hold.high_risk_minutes', value: 2880, description: '48h' },
    { key: 'ops.review_capacity_minutes_per_week', value: 600, description: '§28.B' },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value as object, description: s.description },
      update: {},
    });
  }

  // One demo location so a job can be posted in dev.
  const loc = await prisma.location.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      label: 'Mingora Bazaar (demo)',
      district: 'Swat',
      tehsil: 'Babuzai',
      lat: 34.7795,
      lng: 72.3621,
      precision: 'landmark',
    },
    update: {},
  });

  // One demo employer + worker so the apply→accept loop is testable end-to-end.
  await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      phoneE164: '+923000000010',
      displayName: 'Demo Employer',
      preferredLang: 'ps',
      kycLevel: 1,
      roles: { create: [{ role: 'employer' }] },
      employerProfile: { create: { baseLocationId: loc.id } },
    },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000020' },
    create: {
      id: '00000000-0000-0000-0000-000000000020',
      phoneE164: '+923000000020',
      displayName: 'Demo Worker',
      preferredLang: 'ps',
      kycLevel: 1,
      roles: { create: [{ role: 'worker' }] },
      workerProfile: { create: { bio: 'Demo mason — 10y experience', experienceYears: 10, baseLocationId: loc.id } },
    },
    update: {},
  });

  console.log('seeded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

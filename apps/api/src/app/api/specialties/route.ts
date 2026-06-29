// GET /api/specialties — public, used by the onboarding icon picker (§25.1).
// Cacheable: list is small (≤ 50 entries) and rarely changes; clients cache 24h.
import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await prisma.specialty.findMany({
    where: { active: true },
    orderBy: { slug: 'asc' },
  });
  return NextResponse.json(
    { ok: true, specialties: items },
    {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=86400',
      },
    },
  );
}

// GET /api/specialties/:id/rate-insight — recent day-rate band for a specialty (§26/M27).
// Used by PostJobScreen to show the market range + warn on below-market posts.
import { NextResponse } from 'next/server';
import { rateInsightsService } from '../../../../../services/rate-insights.service';
import { statusFor } from '../../../../../lib/result';
import { getActorOrDevStub } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await rateInsightsService.forSpecialty(id);
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, insight: res.value });
}

// §26/M27 + §25.4 — suggested-rate insights. Surfaces what recent jobs in a specialty
// actually pay, so an employer posting can see the market band and we can softly warn
// when a rate is below the regional 25th percentile ("quality workers may not apply").
// KAFIL informs, never enforces (§26/M27) — the warning is advisory.
//
// v1 scope: percentiles by specialty over a recent window, across all areas. Area-
// scoping (per tehsil/district) is a follow-up once there's enough density to make a
// per-area percentile meaningful — at current volume a specialty-wide band is the
// honest signal and avoids tiny-sample noise. The window + min-sample guard keep us
// from showing a "market rate" derived from two stale postings.

import { prisma } from '../lib/db';
import { ok, type Result } from '../lib/result';

const WINDOW_DAYS = 90; // recent enough to reflect current wages, wide enough for a sample
const MIN_SAMPLE = 4; // below this we don't claim a "market rate" (too noisy to be honest)

export interface RateInsight {
  /** True when we had enough recent data to compute a band. */
  hasData: boolean;
  sampleSize: number;
  /** Daily-rate percentiles in whole PKR (null when hasData is false). */
  p25: number | null;
  median: number | null;
  p75: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Linear interpolation between closest ranks.
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return Math.round(sorted[lo]! * (1 - frac) + sorted[hi]! * frac);
}

export const rateInsightsService = {
  /**
   * Rate band for a specialty over the recent window. Only counts day-rate jobs (the
   * dominant unit) so we compare like with like. Returns hasData:false below MIN_SAMPLE
   * so the UI shows nothing rather than a misleading single-data-point "market".
   */
  async forSpecialty(specialtyId: string): Promise<Result<RateInsight>> {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const rows = await prisma.job.findMany({
      where: {
        rateUnit: 'day',
        createdAt: { gte: since },
        specialties: { some: { specialtyId } },
      },
      select: { ratePkr: true },
      take: 1000,
    });
    const rates = rows.map((r) => r.ratePkr).filter((n) => n > 0).sort((a, b) => a - b);

    if (rates.length < MIN_SAMPLE) {
      return ok({ hasData: false, sampleSize: rates.length, p25: null, median: null, p75: null });
    }
    return ok({
      hasData: true,
      sampleSize: rates.length,
      p25: percentile(rates, 0.25),
      median: percentile(rates, 0.5),
      p75: percentile(rates, 0.75),
    });
  },
};

// Exported for unit tests.
export const __rateInsightsInternals = { percentile, MIN_SAMPLE, WINDOW_DAYS };

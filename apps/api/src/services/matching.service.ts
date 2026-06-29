// §8 Matching & Ranking. A worker opens the app and sees jobs RANKED for them, not a
// raw date list — the difference between "useful" and "noise" for a hyperlocal app.
//
// score(job, worker) =
//     w_specialty · specialty_match        (1 exact, 0.4 related-via-any-overlap, 0 none)
//   + w_distance  · distance_decay(km)      (exp decay; 1 at the door → ~0 far away)
//   + w_reputation· bayesian_rating/5       (employer-side reputation when available)
//   + w_fresh     · freshness(age)          (newer posts surface; decays over days)
//   − p_exposure  · over_exposure(worker)   (the more a worker already holds, the lower
//                                             we rank everything for them so the long
//                                             tail of workers gets a turn — §8 fairness)
//
// Weights are tunable via the `settings` table (feature-flagged per §8) with the
// defaults below. Every ranked feed emits a search event (§16) and carries an
// explainability breakdown per job ("why am I seeing this") for the trust the
// demographic needs.

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { matchingRepository, type JobCandidateRow } from '../repositories/matching.repository';

const DEFAULT_WEIGHTS = {
  specialty: 40,
  distance: 35,
  reputation: 10,
  freshness: 10,
  exposurePenalty: 8, // subtracted, scaled by the worker's active load
};

// Distance decay half-life in metres: score halves every ~3km. Tuned for a tehsil-scale
// market where "walkable / short rickshaw" beats "across the valley".
const DISTANCE_HALFLIFE_M = 3_000;
const DEFAULT_RADIUS_M = 25_000; // 25km candidate radius
const DEFAULT_LIMIT = 30;

export interface RankedJob {
  jobId: string;
  title: string;
  ratePkr: number;
  rateUnit: string;
  durationDays: number | null;
  headcount: number;
  paymentMode: string;
  distanceM: number;
  openSlots: number;
  score: number;
  why: {
    specialtyMatch: number;
    distanceM: number;
    distanceScore: number;
    freshness: number;
    exposurePenalty: number;
  };
}

async function loadWeights(): Promise<typeof DEFAULT_WEIGHTS> {
  const s = await prisma.setting.findUnique({ where: { key: 'matching.weights' } });
  const v = (s?.value ?? null) as Partial<typeof DEFAULT_WEIGHTS> | null;
  return { ...DEFAULT_WEIGHTS, ...(v ?? {}) };
}

/** exp decay in [0,1]: 1 at distance 0, 0.5 at the half-life, →0 far out. */
function distanceDecay(distanceM: number): number {
  return Math.pow(0.5, distanceM / DISTANCE_HALFLIFE_M);
}

/** freshness in [0,1]: 1 for a just-posted job, ~0.5 at 2 days, →0 after a week. */
function freshness(createdAt: Date, now: number): number {
  const ageDays = Math.max(0, (now - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / 2);
}

export const matchingService = {
  /**
   * Ranked job feed for a worker. Returns null-result (empty list) gracefully when the
   * worker has no base location (caller falls back to the plain feed) — and emits
   * search.zero_results when a located worker simply has nothing nearby (a supply lead,
   * §15/§16).
   */
  async rankedJobsForWorker(args: {
    workerId: string;
    now?: Date;
    radiusM?: number;
    limit?: number;
  }): Promise<Result<{ located: boolean; jobs: RankedJob[] }>> {
    const ctx = await matchingRepository.workerContext(args.workerId);
    if (!ctx) {
      // No base location → can't geo-rank. Caller falls back to the date feed.
      return ok({ located: false, jobs: [] });
    }

    const now = (args.now ?? new Date()).getTime();
    const radiusM = args.radiusM ?? DEFAULT_RADIUS_M;
    const limit = args.limit ?? DEFAULT_LIMIT;
    const weights = await loadWeights();

    const [candidates, appliedTo, activeLoad] = await Promise.all([
      matchingRepository.openJobsNear({ lat: ctx.lat, lng: ctx.lng, radiusM, limit: limit * 3 }),
      matchingRepository.workerAppliedJobIds(args.workerId),
      matchingRepository.workerActiveLoad(args.workerId),
    ]);

    const workerSpecs = new Set(ctx.specialtyIds);
    // Over-exposure: a worker already holding many active assignments gets everything
    // ranked lower, so quieter workers surface. Capped so it never fully zeroes a feed.
    const exposurePenalty = Math.min(1, activeLoad / 5) * weights.exposurePenalty;

    const ranked: RankedJob[] = candidates
      .filter((c) => !appliedTo.has(c.id) && c.open_slots > 0)
      .map((c: JobCandidateRow) => {
        const specialtyMatch = specialtyMatchScore(c.specialty_ids, workerSpecs);
        const dDecay = distanceDecay(c.distance_m);
        const fresh = freshness(c.created_at, now);

        const score =
          weights.specialty * specialtyMatch +
          weights.distance * dDecay +
          weights.freshness * fresh -
          exposurePenalty;

        return {
          jobId: c.id,
          title: c.title,
          ratePkr: c.rate_pkr,
          rateUnit: c.rate_unit,
          durationDays: c.duration_days,
          headcount: c.headcount,
          paymentMode: c.payment_mode,
          distanceM: Math.round(c.distance_m),
          openSlots: c.open_slots,
          score: Math.round(score * 1000) / 1000,
          why: {
            specialtyMatch,
            distanceM: Math.round(c.distance_m),
            distanceScore: Math.round(dDecay * 1000) / 1000,
            freshness: Math.round(fresh * 1000) / 1000,
            exposurePenalty: Math.round(exposurePenalty * 1000) / 1000,
          },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    await emitEvent(prisma, {
      eventType: ranked.length === 0 ? 'search.zero_results' : 'search.performed',
      actorId: args.workerId,
      refType: 'worker',
      refId: args.workerId,
      payload: { result_count: ranked.length, radius_m: radiusM, lat: ctx.lat, lng: ctx.lng },
    });

    return ok({ located: true, jobs: ranked });
  },
};

/**
 * 1.0 when the job needs a specialty the worker holds; 0.4 when the job has specialties
 * but the worker shares none (related/uncertain — still shows, ranked lower); 0 only
 * when the worker has specialties and none overlap and the job lists some. A job with
 * no listed specialty is treated as broadly open (0.4).
 */
function specialtyMatchScore(jobSpecialtyIds: string[], workerSpecs: Set<string>): number {
  if (jobSpecialtyIds.length === 0) return 0.4;
  const overlap = jobSpecialtyIds.some((id) => workerSpecs.has(id));
  if (overlap) return 1;
  return workerSpecs.size === 0 ? 0.4 : 0;
}

// Exported for tests.
export const __matchingInternals = { distanceDecay, freshness, specialtyMatchScore };

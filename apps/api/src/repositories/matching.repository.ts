// §8 matching — the PostGIS-backed candidate query. This is the ONLY place that knows
// the spatial column exists (P2). It returns open jobs within a radius of the worker's
// base location, with the geodesic distance in metres, plus the bits the scorer needs
// (specialty ids, open-slot count, employer reliability). Scoring + ranking happen in
// the service; this layer just fetches candidates cheaply using the GiST index.

import { prisma } from '../lib/db';

export interface JobCandidateRow {
  id: string;
  title: string;
  rate_pkr: number;
  rate_unit: string;
  duration_days: number | null;
  headcount: number;
  payment_mode: string;
  created_at: Date;
  distance_m: number; // geodesic metres from the worker's base location
  open_slots: number;
  specialty_ids: string[];
  // recent acceptances of THIS job's employer's jobs — proxy for over-exposure of the
  // job side is not needed; over-exposure is computed per-worker in the worker feed.
}

export const matchingRepository = {
  /**
   * Open jobs near a point, nearest-first, capped. Uses ST_DWithin (index-assisted) to
   * prune by radius, then ST_Distance for the exact metres. All inputs parameterised.
   */
  async openJobsNear(args: {
    lat: number;
    lng: number;
    radiusM: number;
    limit: number;
  }): Promise<JobCandidateRow[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        rate_pkr: number;
        rate_unit: string;
        duration_days: number | null;
        headcount: number;
        payment_mode: string;
        created_at: Date;
        distance_m: number;
        open_slots: bigint;
        specialty_ids: string[] | null;
      }>
    >`
      SELECT
        j.id,
        j.title,
        j.rate_pkr,
        j.rate_unit,
        j.duration_days,
        j.headcount,
        j.payment_mode,
        j.created_at,
        ST_Distance(
          loc.geog,
          ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography
        ) AS distance_m,
        (SELECT COUNT(*) FROM job_slots s WHERE s.job_id = j.id AND s.status = 'open') AS open_slots,
        ARRAY(SELECT js.specialty_id::text FROM job_specialties js WHERE js.job_id = j.id) AS specialty_ids
      FROM jobs j
      JOIN locations loc ON loc.id = j.location_id
      WHERE j.status = 'open'
        AND ST_DWithin(
          loc.geog,
          ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography,
          ${args.radiusM}::double precision
        )
      ORDER BY distance_m ASC
      LIMIT ${args.limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      rate_pkr: r.rate_pkr,
      rate_unit: r.rate_unit,
      duration_days: r.duration_days,
      headcount: r.headcount,
      payment_mode: r.payment_mode,
      created_at: r.created_at,
      distance_m: Number(r.distance_m),
      open_slots: Number(r.open_slots),
      specialty_ids: r.specialty_ids ?? [],
    }));
  },

  /** The worker's base location (lat/lng) + their specialty ids, for scoring. */
  async workerContext(workerId: string): Promise<{
    lat: number;
    lng: number;
    specialtyIds: string[];
  } | null> {
    const wp = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { location: { select: { lat: true, lng: true } } },
    });
    if (!wp?.location) return null;
    const specs = await prisma.workerSpecialty.findMany({
      where: { userId: workerId },
      select: { specialtyId: true },
    });
    return {
      lat: Number(wp.location.lat),
      lng: Number(wp.location.lng),
      specialtyIds: specs.map((s) => s.specialtyId),
    };
  },

  /**
   * Over-exposure signal (§8): how many active assignments this worker already holds.
   * The more they're already winning, the more we de-prioritise them so the long tail
   * gets work. For the WORKER's job feed we instead penalise jobs the worker has
   * already applied to (avoid re-surfacing), counted here.
   */
  async workerActiveLoad(workerId: string): Promise<number> {
    return prisma.assignment.count({
      where: {
        workerId,
        status: { in: ['assigned', 'confirmed', 'in_progress', 'awaiting_employer_confirm', 'awaiting_worker_confirm'] },
      },
    });
  },

  /** Job ids the worker already has an active application on — exclude from the feed. */
  async workerAppliedJobIds(workerId: string): Promise<Set<string>> {
    const apps = await prisma.application.findMany({
      where: { workerId, status: { in: ['pending', 'shortlisted', 'accepted'] } },
      select: { jobId: true },
    });
    return new Set(apps.map((a) => a.jobId));
  },
};

// §6 / §2.2 — DISCOVERY. PostGIS radius queries across the three located entity types
// (jobs, shops, groups). Like matching.repository, this is the ONLY place that knows
// the spatial `geog` column exists (P2). lat/lng/radius are bound params (Prisma tagged
// templates parameterise interpolations — the ST_MakePoint call is inlined so only the
// scalars bind, never raw SQL).

import { prisma } from '../lib/db';

export interface NearbyRow {
  id: string;
  kind: 'job' | 'shop' | 'group';
  title: string;
  subtitle: string | null;
  distanceM: number;
  lat: number;
  lng: number;
}

function clamp(radiusM: number, limit: number) {
  return {
    radiusM: Number.isFinite(radiusM) ? Math.min(100_000, Math.max(1, radiusM)) : 15_000,
    limit: Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.trunc(limit))) : 60,
  };
}

interface RawRow { id: string; title: string; subtitle: string | null; distance_m: number; lat: number; lng: number }
const toRow = (kind: NearbyRow['kind']) => (r: RawRow): NearbyRow => ({
  id: r.id, kind, title: r.title, subtitle: r.subtitle,
  distanceM: Number(r.distance_m), lat: Number(r.lat), lng: Number(r.lng),
});

export const discoveryRepository = {
  async nearbyJobs(args: { lat: number; lng: number; radiusM: number; limit: number }): Promise<NearbyRow[]> {
    const { radiusM, limit } = clamp(args.radiusM, args.limit);
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT j.id, j.title,
             (j.rate_pkr::text || ' PKR/' || j.rate_unit) AS subtitle,
             ST_Distance(loc.geog, ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography) AS distance_m,
             loc.lat::float8 AS lat, loc.lng::float8 AS lng
      FROM jobs j JOIN locations loc ON loc.id = j.location_id
      WHERE j.status = 'open'
        AND ST_DWithin(loc.geog, ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography, ${radiusM}::double precision)
      ORDER BY distance_m ASC LIMIT ${limit}
    `;
    return rows.map(toRow('job'));
  },

  async nearbyShops(args: { lat: number; lng: number; radiusM: number; limit: number }): Promise<NearbyRow[]> {
    const { radiusM, limit } = clamp(args.radiusM, args.limit);
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT s.id, s.name AS title,
             NULLIF(s.description, '') AS subtitle,
             ST_Distance(loc.geog, ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography) AS distance_m,
             loc.lat::float8 AS lat, loc.lng::float8 AS lng
      FROM shops s JOIN locations loc ON loc.id = s.location_id
      WHERE s.status = 'active'
        AND ST_DWithin(loc.geog, ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography, ${radiusM}::double precision)
      ORDER BY distance_m ASC LIMIT ${limit}
    `;
    return rows.map(toRow('shop'));
  },

  async nearbyGroups(args: { lat: number; lng: number; radiusM: number; limit: number }): Promise<NearbyRow[]> {
    const { radiusM, limit } = clamp(args.radiusM, args.limit);
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT g.id, g.name AS title,
             g.category AS subtitle,
             ST_Distance(loc.geog, ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography) AS distance_m,
             loc.lat::float8 AS lat, loc.lng::float8 AS lng
      FROM groups g JOIN locations loc ON loc.id = g.location_id
      WHERE g.status = 'active'
        AND ST_DWithin(loc.geog, ST_SetSRID(ST_MakePoint(${args.lng}::double precision, ${args.lat}::double precision), 4326)::geography, ${radiusM}::double precision)
      ORDER BY distance_m ASC LIMIT ${limit}
    `;
    return rows.map(toRow('group'));
  },
};

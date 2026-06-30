// §6 — DISCOVERY. "What's near me?" across all three pillars at once: jobs, shops,
// community groups. The map/nearby view's data source. Defaults the origin to the
// caller's base location when they don't pass coordinates.

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { ok, type Result } from '../lib/result';
import { discoveryRepository, type NearbyRow } from '../repositories/discovery.repository';

type Kind = 'job' | 'shop' | 'group';

export const discoveryService = {
  /**
   * Nearby entities, nearest-first, merged across kinds. `kinds` filters which pillars
   * to include (default: all). Falls back to the caller's worker base location when
   * lat/lng aren't supplied; returns located:false (empty) if neither is available.
   */
  async nearby(args: {
    userId: string;
    lat?: number;
    lng?: number;
    radiusM?: number;
    kinds?: Kind[];
  }): Promise<Result<{ located: boolean; origin: { lat: number; lng: number } | null; results: NearbyRow[] }>> {
    let lat = args.lat;
    let lng = args.lng;

    // No explicit point → use the caller's base location (worker profile).
    if (lat == null || lng == null) {
      const wp = await prisma.workerProfile.findUnique({
        where: { userId: args.userId },
        select: { location: { select: { lat: true, lng: true } } },
      });
      if (wp?.location) {
        lat = Number(wp.location.lat);
        lng = Number(wp.location.lng);
      }
    }
    if (lat == null || lng == null) {
      return ok({ located: false, origin: null, results: [] });
    }

    const radiusM = args.radiusM ?? 15_000;
    const kinds = args.kinds && args.kinds.length ? args.kinds : (['job', 'shop', 'group'] as Kind[]);
    const want = new Set(kinds);

    const [jobs, shops, groups] = await Promise.all([
      want.has('job') ? discoveryRepository.nearbyJobs({ lat, lng, radiusM, limit: 60 }) : Promise.resolve([]),
      want.has('shop') ? discoveryRepository.nearbyShops({ lat, lng, radiusM, limit: 60 }) : Promise.resolve([]),
      want.has('group') ? discoveryRepository.nearbyGroups({ lat, lng, radiusM, limit: 60 }) : Promise.resolve([]),
    ]);

    const results = [...jobs, ...shops, ...groups].sort((a, b) => a.distanceM - b.distanceM);

    await emitEvent(prisma, {
      eventType: 'discovery.nearby',
      actorId: args.userId,
      refType: 'user',
      refId: args.userId,
      payload: { radius_m: radiusM, kinds, result_count: results.length },
    });

    return ok({ located: true, origin: { lat, lng }, results });
  },
};

'use client';

// Client boundary for the Leaflet map. react-leaflet touches `window` at import time, so
// it must be dynamically imported with ssr:false — and Next 16 only allows ssr:false in a
// Client Component (not a Server Component page). This thin wrapper is that boundary; the
// server page renders <MapClient> and passes plain data.

import dynamic from 'next/dynamic';
import type { MapPoint } from './NearbyMap';

const NearbyMap = dynamic(() => import('./NearbyMap').then((m) => m.NearbyMap), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

export function MapClient({ points, origin }: { points: MapPoint[]; origin: { lat: number; lng: number } }) {
  return <NearbyMap points={points} origin={origin} />;
}

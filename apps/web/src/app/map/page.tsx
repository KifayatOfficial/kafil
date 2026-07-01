import { TopNav } from '../../components/TopNav';
import { fetchJson } from '../../lib/serverApi';
import { MapClient } from '../../components/MapClient';
import type { MapPoint } from '../../components/NearbyMap';

interface NearbyRow {
  id: string;
  kind: 'job' | 'shop' | 'group';
  title: string;
  distanceM: number;
  lat: number;
  lng: number;
}

const ORIGIN = { lat: 34.78, lng: 72.36 };

export default async function MapPage() {
  const data = await fetchJson<{ results: NearbyRow[] }>(
    `/api/discovery/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`,
  );
  const points: MapPoint[] = (data?.results ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    lat: r.lat,
    lng: r.lng,
    distanceM: r.distanceM,
  }));

  return (
    <div className="page">
      <TopNav active="/nearby" />
      <main className="container">
        <div className="section-head">
          <h2>🗺️ Map</h2>
          <span className="count-pill">{points.length}</span>
        </div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Live OpenStreetMap — jobs, shops, and groups near Mingora Bazaar. Tap a pin for details.
        </p>
        <MapClient points={points} origin={ORIGIN} />
      </main>
    </div>
  );
}

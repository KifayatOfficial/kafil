import { TopNav } from '../../components/TopNav';
import { fetchJson } from '../../lib/serverApi';

interface NearbyRow {
  id: string;
  kind: 'job' | 'shop' | 'group';
  title: string;
  distanceM: number;
  lat: number;
  lng: number;
}

const ORIGIN = { lat: 34.78, lng: 72.36 };
const GLYPH = { job: '🧰', shop: '🏪', group: '🏘️' } as const;

// Honest scope: KAFIL ships no tile-map dependency (react-native-maps / Leaflet aren't
// installed anywhere). This is a lightweight *coordinate plot* — each located result is
// positioned by its offset from the origin onto a scaled pad. It conveys spatial spread
// ("3 jobs clustered north, a shop to the east") without pretending to be Google Maps.
// A real map layer can drop in later reading the same lat/lng.
export default async function MapPage() {
  const data = await fetchJson<{ results: NearbyRow[] }>(
    `/api/discovery/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`,
  );
  const results = data?.results ?? [];

  // Scale offsets (degrees) into a 0–100% pad. Find the max spread to fit everything.
  const maxSpread =
    Math.max(0.001, ...results.map((r) => Math.max(Math.abs(r.lat - ORIGIN.lat), Math.abs(r.lng - ORIGIN.lng)))) * 1.2;
  const pos = (r: NearbyRow) => ({
    left: `${50 + ((r.lng - ORIGIN.lng) / maxSpread) * 45}%`,
    top: `${50 - ((r.lat - ORIGIN.lat) / maxSpread) * 45}%`, // north = up
  });

  return (
    <div className="page">
      <TopNav active="/nearby" />
      <main className="container">
        <div className="section-head">
          <h2>🗺️ Map — spatial view</h2>
          <span className="count-pill">{results.length}</span>
        </div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Located results plotted by distance + direction from Mingora Bazaar. A full tile map
          layers on later reading the same coordinates.
        </p>

        <div className="mappad">
          <div className="map-origin" title="Mingora Bazaar (you)">
            📍
          </div>
          {results.map((r) => (
            <div className="map-pin" key={`${r.kind}:${r.id}`} style={pos(r)} title={`${r.title} · ${Math.round(r.distanceM)}m`}>
              <span className="map-pin-glyph">{GLYPH[r.kind]}</span>
              <span className="map-pin-label">{r.title}</span>
            </div>
          ))}
          {results.length === 0 ? <div className="map-empty">No located results to plot.</div> : null}
        </div>
      </main>
    </div>
  );
}

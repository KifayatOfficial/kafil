import { TopNav } from '../../components/TopNav';
import { fetchJson } from '../../lib/serverApi';

interface NearbyRow {
  id: string;
  kind: 'job' | 'shop' | 'group';
  title: string;
  subtitle: string | null;
  distanceM: number;
  lat: number;
  lng: number;
}

// Demo origin — Mingora Bazaar. On mobile this is the device's GPS; the desktop shell
// uses a fixed point so the "what's around here" view is demonstrable.
const ORIGIN = { lat: 34.78, lng: 72.36 };

const KIND = {
  job: { glyph: '🧰', label: 'Job' },
  shop: { glyph: '🏪', label: 'Shop' },
  group: { glyph: '🏘️', label: 'Group' },
} as const;

const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export default async function NearbyPage() {
  const data = await fetchJson<{ located: boolean; results: NearbyRow[] }>(
    `/api/discovery/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`,
  );
  const results = data?.results ?? [];

  return (
    <div className="page">
      <TopNav active="/nearby" />
      <main className="container">
        <div className="section-head">
          <h2>📍 Nearby — around Mingora Bazaar</h2>
          <span className="count-pill">{results.length}</span>
        </div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Jobs, shops, and groups within range, closest first. (On mobile this uses your live location.)
        </p>

        {results.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              📍
            </div>
            <p className="empty-title">Nothing nearby yet</p>
            <p className="muted">Seed located jobs/shops/groups to populate discovery.</p>
          </div>
        ) : (
          <div className="grid">
            {results.map((r) => (
              <article className="card nearby-card" key={`${r.kind}:${r.id}`}>
                <span className="nearby-glyph" aria-hidden>
                  {KIND[r.kind].glyph}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="card-headline">
                    <h3 className="job-title">{r.title}</h3>
                    <span className="chip chip-rate">{km(r.distanceM)}</span>
                  </div>
                  <div className="job-meta">
                    <span className="chip">{KIND[r.kind].label}</span>
                    {r.subtitle ? <span className="chip">{r.subtitle}</span> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

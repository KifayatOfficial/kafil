import { TopNav } from '../../components/TopNav';
import { fetchList } from '../../lib/serverApi';

interface Shop {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  verifiedTier: string;
  rating: number;
  location: { label: string; district: string | null } | null;
}

const TIER_BADGE: Record<string, { label: string; cls: string }> = {
  verified: { label: '✓ Verified', cls: 'badge' },
  featured: { label: '★ Featured', cls: 'badge badge-accent' },
};

export default async function ShopsPage() {
  const shops = await fetchList<Shop>('/api/shops', 'shops');
  const verified = shops.filter((s) => s.verifiedTier !== 'free').length;
  const avg = shops.length ? (shops.reduce((s, x) => s + x.rating, 0) / shops.length).toFixed(1) : '—';

  return (
    <div className="page">
      <TopNav active="/shops" />
      <main className="container">
        <section className="stats">
          <div className="stat stat-primary">
            <div className="stat-value">{shops.length}</div>
            <div className="stat-label">Shops</div>
          </div>
          <div className="stat stat-accent">
            <div className="stat-value">{verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {avg}
              <span className="stat-suffix"> ★</span>
            </div>
            <div className="stat-label">Avg rating</div>
          </div>
        </section>

        <div className="section-head">
          <h2>Shop directory</h2>
          <span className="count-pill">{shops.length}</span>
        </div>

        {shops.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              🏪
            </div>
            <p className="empty-title">No shops yet</p>
            <p className="muted">Seed the database to populate the directory.</p>
          </div>
        ) : (
          <div className="grid">
            {shops.map((s) => {
              const tier = TIER_BADGE[s.verifiedTier];
              return (
                <a className="card shop-card card-link" key={s.id} href={`/shops/${s.id}`}>
                  <div className="card-headline">
                    <h3 className="job-title">{s.name}</h3>
                    {tier ? <span className={tier.cls}>{tier.label}</span> : null}
                  </div>
                  {s.description ? <p className="job-desc">{s.description}</p> : null}
                  <div className="job-meta">
                    <span className="chip chip-rate">★ {s.rating.toFixed(1)}</span>
                    {s.categories.slice(0, 3).map((c) => (
                      <span className="chip" key={c}>
                        {c}
                      </span>
                    ))}
                    {s.location?.district ? <span className="chip">📍 {s.location.district}</span> : null}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

import { TopNav } from '../../../components/TopNav';
import { fetchJson } from '../../../lib/serverApi';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  author?: { displayName: string } | null;
}
interface Shop {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  photos: string[];
  hours: Record<string, Array<{ open: string; close: string }>> | null;
  verifiedTier: string;
  rating: number;
  reviewCount: number;
  owner?: { displayName: string } | null;
  location: { label: string; district: string | null } | null;
  reviews?: Review[];
}

const TIER: Record<string, string> = { verified: '✓ Verified', featured: '★ Featured' };
const DAYS: Array<[string, string]> = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
];

export default async function ShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchJson<{ shop: Shop }>(`/api/shops/${id}`);
  const shop = data?.shop ?? null;

  return (
    <div className="page">
      <TopNav active="/shops" />
      <main className="container" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <a href="/shops" className="chip">← Shops</a>
        </div>

        {!shop ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>🏪</div>
            <p className="empty-title">Shop not found</p>
          </div>
        ) : (
          <>
            <section className="card detail-head">
              <div className="detail-icon" aria-hidden>🏪</div>
              <div style={{ flex: 1 }}>
                <div className="card-headline">
                  <h2 style={{ margin: 0 }}>{shop.name}</h2>
                  {TIER[shop.verifiedTier] ? <span className="badge">{TIER[shop.verifiedTier]}</span> : null}
                </div>
                {shop.description ? <p className="job-desc">{shop.description}</p> : null}
                <div className="job-meta">
                  <span className="chip chip-rate">★ {shop.rating.toFixed(1)} ({shop.reviewCount})</span>
                  {shop.categories.map((c) => <span className="chip" key={c}>{c}</span>)}
                  {shop.location?.district ? <span className="chip">📍 {shop.location.district}</span> : null}
                  {shop.owner?.displayName ? <span className="chip">👤 {shop.owner.displayName}</span> : null}
                </div>
              </div>
            </section>

            {shop.hours ? (
              <>
                <div className="section-head"><h2>Hours</h2></div>
                <div className="card hours-grid">
                  {DAYS.map(([k, label]) => {
                    const slots = shop.hours?.[k];
                    return (
                      <div className="hours-row" key={k}>
                        <span className="hours-day">{label}</span>
                        <span className="hours-val">
                          {slots && slots.length ? slots.map((s) => `${s.open}–${s.close}`).join(', ') : 'Closed'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            <div className="section-head">
              <h2>Reviews</h2>
              <span className="count-pill">{shop.reviews?.length ?? 0}</span>
            </div>
            {shop.reviews && shop.reviews.length ? (
              <div className="list">
                {shop.reviews.map((r) => (
                  <article className="card" key={r.id}>
                    <div className="card-headline">
                      <strong>{r.author?.displayName ?? 'Customer'}</strong>
                      <span className="chip chip-rate">{'★'.repeat(r.rating)}</span>
                    </div>
                    {r.comment ? <p className="job-desc" style={{ marginTop: 6 }}>{r.comment}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No reviews yet.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

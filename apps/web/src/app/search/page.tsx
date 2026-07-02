import { TopNav } from '../../components/TopNav';
import { fetchList } from '../../lib/serverApi';
import { pkr } from '../../lib/format';

// Global search — spans the three pillars. There's no dedicated search endpoint yet, so
// this fans out to the existing list endpoints and filters by text server-side. It's a
// real, useful cross-pillar search for the current dataset; when the API grows a proper
// full-text/opensearch endpoint, this page swaps its data source with no UI change.

interface Job { id: string; title: string; description?: string | null; ratePkr: number; rateUnit: string; status: string }
interface Shop { id: string; name: string; description: string | null; categories: string[]; rating: number; verifiedTier: string }
interface Group { id: string; name: string; description: string | null; category: string | null; memberCount: number }

const norm = (s: unknown) => String(s ?? '').toLowerCase();

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const ql = query.toLowerCase();

  // Only fetch when there's a query — an empty search shouldn't dump the whole dataset.
  const [jobs, shops, groups] = query
    ? await Promise.all([
        fetchList<Job>('/api/jobs', 'jobs'),
        fetchList<Shop>('/api/shops', 'shops'),
        fetchList<Group>('/api/groups', 'groups'),
      ])
    : [[], [], []];

  const jobHits = jobs.filter((j) => norm(j.title).includes(ql) || norm(j.description).includes(ql));
  const shopHits = shops.filter(
    (s) => norm(s.name).includes(ql) || norm(s.description).includes(ql) || s.categories.some((c) => norm(c).includes(ql)),
  );
  const groupHits = groups.filter(
    (g) => norm(g.name).includes(ql) || norm(g.description).includes(ql) || norm(g.category).includes(ql),
  );
  const total = jobHits.length + shopHits.length + groupHits.length;

  return (
    <div className="page">
      <TopNav active="/" />
      <main className="container" style={{ maxWidth: 820 }}>
        <div className="section-head">
          <h2>🔎 Search</h2>
          {query ? <span className="count-pill">{total}</span> : null}
        </div>

        <form action="/search" className="search-form">
          <input name="q" className="input" placeholder="Search jobs, shops, groups…" defaultValue={query} autoFocus />
          <button type="submit" className="btn">Search</button>
        </form>

        {!query ? (
          <p className="muted" style={{ marginTop: 16 }}>Type a keyword — e.g. “mason”, “cement”, “Mingora”.</p>
        ) : total === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>🔍</div>
            <p className="empty-title">No results for “{query}”</p>
            <p className="muted">Try a shorter or different keyword.</p>
          </div>
        ) : (
          <>
            {jobHits.length ? (
              <>
                <div className="section-head"><h2>🧰 Jobs</h2><span className="count-pill">{jobHits.length}</span></div>
                <div className="list">
                  {jobHits.map((j) => (
                    <a key={j.id} href={`/job/${j.id}`} className="card card-link">
                      <div className="card-headline"><h3 className="job-title">{j.title}</h3><span className="chip chip-rate">{pkr(j.ratePkr)} PKR/{j.rateUnit}</span></div>
                      {j.description ? <p className="job-desc" style={{ marginTop: 6 }}>{j.description}</p> : null}
                    </a>
                  ))}
                </div>
              </>
            ) : null}

            {shopHits.length ? (
              <>
                <div className="section-head"><h2>🏪 Shops</h2><span className="count-pill">{shopHits.length}</span></div>
                <div className="list">
                  {shopHits.map((s) => (
                    <a key={s.id} href={`/shops/${s.id}`} className="card card-link">
                      <div className="card-headline"><h3 className="job-title">{s.name}</h3><span className="chip chip-rate">★ {s.rating.toFixed(1)}</span></div>
                      {s.description ? <p className="job-desc" style={{ marginTop: 6 }}>{s.description}</p> : null}
                      <div className="job-meta">{s.categories.slice(0, 3).map((c) => <span className="chip" key={c}>{c}</span>)}</div>
                    </a>
                  ))}
                </div>
              </>
            ) : null}

            {groupHits.length ? (
              <>
                <div className="section-head"><h2>🏘️ Groups</h2><span className="count-pill">{groupHits.length}</span></div>
                <div className="list">
                  {groupHits.map((g) => (
                    <a key={g.id} href={`/community/${g.id}`} className="card card-link">
                      <div className="card-headline"><h3 className="job-title">{g.name}</h3>{g.category ? <span className="badge">{g.category}</span> : null}</div>
                      {g.description ? <p className="job-desc" style={{ marginTop: 6 }}>{g.description}</p> : null}
                      <div className="job-meta"><span className="chip">👥 {g.memberCount} members</span></div>
                    </a>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

import { TopNav } from '../../../components/TopNav';
import { fetchJson } from '../../../lib/serverApi';

interface Slot {
  id: string;
  status: string;
  assignedWorkerId: string | null;
  slotIndex: number;
}
interface Job {
  id: string;
  title: string;
  description: string | null;
  ratePkr: number;
  rateUnit: string;
  headcount: number;
  durationDays: number | null;
  status: string;
  paymentMode: string;
  featuredUntil: string | null;
  createdAt: string;
  slots?: Slot[];
  specialties?: Array<{ specialty?: { nameEn: string | null; slug: string } }>;
}

const pkr = (n: number) => new Intl.NumberFormat('en-PK').format(n);

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchJson<{ job: Job } | Job>(`/api/jobs/${id}`);
  // Endpoint returns the job either bare or under `job`.
  const job = (data && 'job' in data ? data.job : (data as Job)) || null;

  const featured = !!job?.featuredUntil && new Date(job.featuredUntil).getTime() > Date.now();
  const filled = job?.slots?.filter((s) => s.status !== 'open').length ?? 0;
  const total = job?.slots?.length ?? job?.headcount ?? 0;

  return (
    <div className="page">
      <TopNav active="/" />
      <main className="container" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <a href="/" className="chip">← Work</a>
        </div>

        {!job ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>🗂️</div>
            <p className="empty-title">Job not found</p>
          </div>
        ) : (
          <>
            <section className={`card detail-head${featured ? ' job-card-featured' : ''}`}>
              <div className="detail-icon" aria-hidden>🧰</div>
              <div style={{ flex: 1 }}>
                <div className="card-headline">
                  <h2 style={{ margin: 0 }}>{job.title}</h2>
                  {featured ? <span className="badge badge-accent">★ Featured</span> : null}
                </div>
                <div className="job-meta">
                  <span className="chip chip-rate">{pkr(job.ratePkr)} PKR / {job.rateUnit}</span>
                  <span className="chip chip-status">{job.status}</span>
                  <span className="chip">{job.paymentMode === 'escrow' ? '🔒 Escrow' : '💵 Cash'}</span>
                  {job.durationDays ? <span className="chip">📅 {job.durationDays} days</span> : null}
                </div>
              </div>
            </section>

            {job.description ? (
              <>
                <div className="section-head"><h2>Description</h2></div>
                <article className="card"><p style={{ margin: 0 }}>{job.description}</p></article>
              </>
            ) : null}

            <div className="section-head"><h2>Positions</h2></div>
            <article className="card">
              <div className="job-meta">
                <span className="chip chip-rate">👷 {filled}/{total} filled</span>
              </div>
              <div className="slot-row">
                {Array.from({ length: total }, (_, i) => {
                  const slot = job.slots?.[i];
                  const open = !slot || slot.status === 'open';
                  return (
                    <span key={i} className={`slot ${open ? 'slot-open' : 'slot-filled'}`} title={open ? 'Open' : 'Filled'}>
                      {open ? '🪑' : '🧑‍🔧'}
                    </span>
                  );
                })}
              </div>
            </article>

            {job.specialties && job.specialties.length ? (
              <>
                <div className="section-head"><h2>Skills needed</h2></div>
                <div className="job-meta">
                  {job.specialties.map((s, i) => (
                    <span className="badge" key={i}>{s.specialty?.nameEn ?? s.specialty?.slug ?? 'skill'}</span>
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

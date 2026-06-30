import { i18n } from '@kafil/core';

interface Job {
  id: string;
  title: string;
  description?: string | null;
  ratePkr: number;
  rateUnit: string;
  status: string;
  headcount?: number;
  durationDays?: number | null;
  featured?: boolean;
  featuredUntil?: string | null;
}

async function fetchJobs(): Promise<Job[]> {
  const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3001'}/api/jobs`, {
    // Next.js extends RequestInit at runtime; use a cast so type-strict mode is happy.
    ...({ cache: 'no-store' } as RequestInit),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { jobs: Job[] };
  return data.jobs ?? [];
}

function isFeatured(j: Job): boolean {
  return j.featured === true || (!!j.featuredUntil && new Date(j.featuredUntil).getTime() > Date.now());
}

// PKR formatting with thousands separators — admins scan rates fast.
const pkr = (n: number) => new Intl.NumberFormat('en-PK').format(n);

export default async function Page() {
  const jobs = await fetchJobs();
  const t = (k: Parameters<typeof i18n.t>[1]) => i18n.t('ps', k);

  const featuredCount = jobs.filter(isFeatured).length;
  const totalHeadcount = jobs.reduce((s, j) => s + (j.headcount ?? 1), 0);
  const avgRate = jobs.length ? Math.round(jobs.reduce((s, j) => s + j.ratePkr, 0) / jobs.length) : 0;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ك
          </span>
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-tag">Desktop / admin · Mobile is primary (§23)</div>
          </div>
        </div>
        <span className="theme-hint" title="Follows your system light/dark setting">
          🌗 Auto theme
        </span>
      </header>

      <main className="container">
        <section className="stats">
          <StatCard label="Open jobs" value={String(jobs.length)} tone="primary" />
          <StatCard label="Featured" value={String(featuredCount)} tone="accent" />
          <StatCard label="Positions" value={String(totalHeadcount)} />
          <StatCard label="Avg rate" value={avgRate ? `${pkr(avgRate)} PKR` : '—'} suffix="/ day" />
        </section>

        <div className="section-head">
          <h2>Open jobs</h2>
          <span className="count-pill">{jobs.length}</span>
        </div>

        {jobs.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              🗂️
            </div>
            <p className="empty-title">{i18n.t('ps', 'empty.no_jobs')}</p>
            <p className="muted">Seed the database to populate the feed.</p>
          </div>
        ) : (
          <div className="grid">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: 'primary' | 'accent';
}) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-value">
        {value}
        {suffix ? <span className="stat-suffix"> {suffix}</span> : null}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const featured = isFeatured(job);
  return (
    <article className={`card job-card${featured ? ' job-card-featured' : ''}`}>
      {featured ? <span className="ribbon">★ Featured</span> : null}
      <h3 className="job-title">{job.title}</h3>
      {job.description ? <p className="job-desc">{job.description}</p> : null}
      <div className="job-meta">
        <span className="chip chip-rate">
          {new Intl.NumberFormat('en-PK').format(job.ratePkr)} PKR / {job.rateUnit}
        </span>
        {job.headcount && job.headcount > 1 ? <span className="chip">👷 {job.headcount} needed</span> : null}
        {job.durationDays ? <span className="chip">📅 {job.durationDays}d</span> : null}
        <span className="chip chip-status">{job.status}</span>
      </div>
    </article>
  );
}

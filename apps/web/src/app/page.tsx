import { TopNav } from '../components/TopNav';
import { QuickForm } from '../components/QuickForm';
import { postJobAction } from './actions';
import { FadeRise, Stagger, StaggerItem, Lift, CountUp } from '../components/motion';
import { IconWork, IconUsers, IconStar, IconCalendar } from '../components/icons';

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

  const featuredCount = jobs.filter(isFeatured).length;
  const totalHeadcount = jobs.reduce((s, j) => s + (j.headcount ?? 1), 0);
  const avgRate = jobs.length ? Math.round(jobs.reduce((s, j) => s + j.ratePkr, 0) / jobs.length) : 0;

  return (
    <div className="page">
      <TopNav active="/" />

      <main className="container">
        {/* Stats "boot up" — numbers count from 0, whole strip staggers in. */}
        <Stagger className="stats">
          <StaggerItem>
            <StatCard label="Open jobs" valueNum={jobs.length} tone="primary" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Featured" valueNum={featuredCount} tone="accent" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Positions" valueNum={totalHeadcount} />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Avg rate" valueNum={avgRate} suffix={avgRate ? '/ day' : undefined} unit={avgRate ? 'PKR' : '—'} />
          </StaggerItem>
        </Stagger>

        <FadeRise delay={0.15}>
          <div className="section-head">
            <h2>Open jobs</h2>
            <span className="count-pill">{jobs.length}</span>
            <span style={{ flex: 1 }} />
            <QuickForm action={postJobAction} openLabel="＋ Post a job" submitLabel="Post job">
              <input name="title" className="input" placeholder="Job title (e.g. Mason for boundary wall)" maxLength={200} />
              <input name="rate" className="input" type="number" placeholder="Daily rate (PKR)" min={1} />
              <textarea name="description" className="input" placeholder="Describe the work (optional)" rows={2} maxLength={4000} />
            </QuickForm>
          </div>
        </FadeRise>

        {jobs.length === 0 ? (
          <FadeRise delay={0.2}>
            <div className="empty">
              <div className="empty-glyph" aria-hidden>
                <IconWork size={48} />
              </div>
              <p className="empty-title">No open jobs yet</p>
              <p className="muted">Seed the database to populate the feed.</p>
            </div>
          </FadeRise>
        ) : (
          <Stagger className="grid">
            {jobs.map((j) => (
              <StaggerItem key={j.id}>
                <JobCard job={j} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  valueNum,
  suffix,
  unit,
  tone,
}: {
  label: string;
  valueNum: number;
  suffix?: string;
  unit?: string;
  tone?: 'primary' | 'accent';
}) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-value">
        {unit === '—' ? '—' : <CountUp value={valueNum} />}
        {unit && unit !== '—' ? <span className="stat-suffix"> {unit}</span> : null}
        {suffix ? <span className="stat-suffix"> {suffix}</span> : null}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const featured = isFeatured(job);
  return (
    <Lift className={`card job-card card-link${featured ? ' job-card-featured' : ''}`} href={`/job/${job.id}`}>
      {featured ? (
        <span className="ribbon">
          <IconStar size={12} /> Featured
        </span>
      ) : null}
      <div className="job-card-top">
        <span className="job-icon" aria-hidden>
          <IconWork size={20} />
        </span>
        <h3 className="job-title">{job.title}</h3>
      </div>
      {job.description ? <p className="job-desc">{job.description}</p> : null}
      <div className="job-meta">
        <span className="chip chip-rate">
          {pkr(job.ratePkr)} PKR / {job.rateUnit}
        </span>
        {job.headcount && job.headcount > 1 ? (
          <span className="chip">
            <IconUsers size={13} /> {job.headcount} needed
          </span>
        ) : null}
        {job.durationDays ? (
          <span className="chip">
            <IconCalendar size={13} /> {job.durationDays}d
          </span>
        ) : null}
        <span className="chip chip-status">{job.status}</span>
      </div>
    </Lift>
  );
}

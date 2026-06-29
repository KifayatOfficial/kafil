import { i18n } from '@kafil/core';

async function fetchJobs() {
  const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3001'}/api/jobs`, {
    // Next.js extends RequestInit at runtime; use a cast so type-strict mode is happy.
    ...({ cache: 'no-store' } as RequestInit),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { jobs: Array<{ id: string; title: string; ratePkr: number; rateUnit: string; status: string }> };
  return data.jobs ?? [];
}

export default async function Page() {
  const jobs = await fetchJobs();
  const t = (k: Parameters<typeof i18n.t>[1]) => i18n.t('ps', k);

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1>{t('app.name')}</h1>
      <p className="muted">Desktop / admin shell. Mobile is primary (§23).</p>

      <h2 style={{ marginTop: 32 }}>Open jobs ({jobs.length})</h2>
      {jobs.length === 0 ? (
        <p className="muted">{i18n.t('ps', 'empty.no_jobs')}</p>
      ) : (
        jobs.map((j) => (
          <div className="card" key={j.id}>
            <strong>{j.title}</strong>
            <div className="muted">
              {j.ratePkr} PKR / {j.rateUnit} · status {j.status}
            </div>
          </div>
        ))
      )}
    </main>
  );
}

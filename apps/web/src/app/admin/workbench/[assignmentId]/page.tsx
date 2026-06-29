// Workbench case detail: full timeline + chat + fraud signals + resolve dropdown.
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { buildClient, readAdminToken, writeAdminToken } from '../../../../lib/api';
import { randomUUID } from '@kafil/core';

interface Detail {
  assignment: {
    id: string;
    status: string;
    workerId: string;
    worker: { id: string; displayName: string; phoneE164: string; kycLevel: number };
    job: { id: string; title: string; employerId: string; ratePkr: number; rateUnit: string };
    completedAt: string | null;
    workerMarkedDoneAt: string | null;
    employerMarkedDoneAt: string | null;
  };
  events: Array<{ id: number | string; eventType: string; occurredAt: string; actorId: string | null; payload: unknown }>;
  conversation: {
    id: string;
    messages: Array<{ id: string; senderId: string; body: string | null; bodyRedacted: string | null; flagged: boolean; createdAt: string }>;
  } | null;
  fraudSignals: Array<{ id: string; userId: string | null; signal: string; weight: number; createdAt: string }>;
}

// Keep in sync with workbench.service.Resolution
const RESOLUTIONS = [
  ['complete_in_active_party_favor', 'Complete (active party wins)'],
  ['pay_worker', 'Pay worker'],
  ['refund_employer', 'Refund employer'],
  ['partial', 'Partial (notes only)'],
  ['no_action', 'No action'],
  ['cancel', 'Cancel assignment'],
  ['open_formal_dispute', 'Open formal dispute'],
  ['ban', 'Ban (user)'],
] as const;

export default function WorkbenchDetailPage() {
  const router = useRouter();
  const params = useParams<{ assignmentId: string }>();
  const id = params?.assignmentId;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number][0]>('complete_in_active_party_favor');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!readAdminToken()) {
      router.replace('/admin/login');
      return;
    }
    if (!id) return;
    const c = buildClient();
    (async () => {
      const r = await c.get<{ ok: true } & Detail>(`/api/admin/workbench/${id}`);
      if (r.success) setData(r.data as Detail);
      else if (r.status === 401 || r.status === 403) {
        writeAdminToken(null);
        router.replace('/admin/login');
      } else {
        setError((r.data as { message?: string }).message ?? 'failed to load');
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : 'network'));
  }, [id, router]);

  const submit = async () => {
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const key = randomUUID();
    const c = buildClient();
    const r = await c.post(`/api/admin/workbench/${id}/resolve`, { resolution, note }, { idempotencyKey: key });
    if (r.success) {
      setDone(`Resolved as ${resolution}`);
      // Refresh
      const reload = await c.get<{ ok: true } & Detail>(`/api/admin/workbench/${id}`);
      if (reload.success) setData(reload.data as Detail);
    } else {
      setError((r.data as { message?: string }).message ?? `failed (${r.status})`);
    }
    setBusy(false);
  };

  if (!id) return null;

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: '0 auto', fontFamily: 'system-ui' }}>
      <a href="/admin/workbench" style={{ color: '#1f7a4d' }}>
        ← Back to queue
      </a>
      <h1 style={{ marginTop: 12 }}>{data?.assignment.job.title ?? '…'}</h1>
      {error ? <p style={{ color: '#b23a2e' }}>{error}</p> : null}

      {data ? (
        <>
          <section style={{ marginTop: 20 }}>
            <h2>Case</h2>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                <tr><td className="muted" style={{ padding: 4 }}>Status</td><td>{data.assignment.status}</td></tr>
                <tr><td className="muted" style={{ padding: 4 }}>Worker</td><td>{data.assignment.worker.displayName} (KYC L{data.assignment.worker.kycLevel})</td></tr>
                <tr><td className="muted" style={{ padding: 4 }}>Rate</td><td>{data.assignment.job.ratePkr} PKR / {data.assignment.job.rateUnit}</td></tr>
                <tr><td className="muted" style={{ padding: 4 }}>Worker marked done</td><td>{data.assignment.workerMarkedDoneAt ?? '—'}</td></tr>
                <tr><td className="muted" style={{ padding: 4 }}>Employer marked done</td><td>{data.assignment.employerMarkedDoneAt ?? '—'}</td></tr>
              </tbody>
            </table>
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>Event timeline ({data.events.length})</h2>
            <ol style={{ paddingLeft: 18 }}>
              {data.events.map((e) => (
                <li key={String(e.id)} style={{ fontSize: 13, marginBottom: 4 }}>
                  <code>{e.eventType}</code> <span className="muted">· {new Date(e.occurredAt).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </section>

          {data.conversation ? (
            <section style={{ marginTop: 24 }}>
              <h2>Chat transcript</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                Investigator view shows raw + redacted side by side. Raw is moderator-only — never shown to users.
              </p>
              <div style={{ background: 'var(--surface, #fff)', padding: 12, borderRadius: 8 }}>
                {data.conversation.messages.length === 0 ? (
                  <p className="muted">No messages.</p>
                ) : (
                  data.conversation.messages.map((m) => (
                    <div key={m.id} style={{ paddingBottom: 6, borderBottom: '1px dashed #eee', marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {new Date(m.createdAt).toLocaleTimeString()} · sender {m.senderId.slice(0, 8)}…{' '}
                        {m.flagged ? <strong style={{ color: '#c28a1e' }}>FLAGGED</strong> : null}
                      </div>
                      <div style={{ marginTop: 2 }}>{m.bodyRedacted ?? m.body}</div>
                      {m.flagged && m.body && m.body !== m.bodyRedacted ? (
                        <div style={{ marginTop: 2, fontSize: 12, color: '#b23a2e' }}>
                          <em>raw:</em> {m.body}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {data.fraudSignals.length > 0 ? (
            <section style={{ marginTop: 24 }}>
              <h2>Fraud signals on parties</h2>
              <ul style={{ fontSize: 13 }}>
                {data.fraudSignals.map((s) => (
                  <li key={s.id}>
                    <code>{s.signal}</code> · weight {s.weight} · {new Date(s.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section style={{ marginTop: 32 }}>
            <h2>Resolve</h2>
            <label>
              <div style={{ marginBottom: 6 }}>Resolution</div>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as (typeof RESOLUTIONS)[number][0])}
                style={{ width: '100%', padding: 8 }}
              >
                {RESOLUTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ margin: '12px 0 6px' }}>Notes (visible to ops only)</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: 8 }}
              />
            </label>
            <button className="btn" disabled={busy} onClick={submit} style={{ marginTop: 12 }}>
              {busy ? 'Resolving…' : 'Apply resolution'}
            </button>
            {done ? <p style={{ color: '#1f7a4d', marginTop: 8 }}>{done}</p> : null}
          </section>
        </>
      ) : (
        <p>Loading…</p>
      )}
    </main>
  );
}

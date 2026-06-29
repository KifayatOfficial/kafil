// Workbench queue: list of items needing ops attention.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildClient, readAdminToken, writeAdminToken } from '../../../lib/api';

interface Item {
  source: 'ops_review' | 'dispute';
  assignmentId: string;
  disputeId: string | null;
  jobTitle: string;
  status: string;
  workerId: string;
  employerId: string;
  openedAt: string;
}

export default function WorkbenchListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!readAdminToken()) {
      router.replace('/admin/login');
      return;
    }
    const c = buildClient();
    (async () => {
      const r = await c.get<{ ok: true; items: Item[] }>('/api/admin/workbench');
      if (r.success) setItems((r.data as { items: Item[] }).items);
      else if (r.status === 401 || r.status === 403) {
        writeAdminToken(null);
        router.replace('/admin/login');
      } else {
        setError((r.data as { message?: string }).message ?? 'failed to load');
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : 'network'));
  }, [router]);

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: '0 auto', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Workbench</h1>
        <nav style={{ display: 'flex', gap: 16 }}>
          <Link href="/admin/reports" style={{ color: '#1f7a4d' }}>
            Reports →
          </Link>
          <button
            type="button"
            onClick={() => {
              writeAdminToken(null);
              router.replace('/admin/login');
            }}
            style={{
              border: 0,
              background: 'transparent',
              color: '#1f7a4d',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </nav>
      </header>

      <p className="muted">
        Cases needing review: <code>awaiting_ops_review</code> assignments (from §26/M1) plus open
        disputes.
      </p>

      {error ? <p style={{ color: '#b23a2e' }}>{error}</p> : null}

      {items === null ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">Queue is empty. Nice.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
              <th style={{ padding: 8 }}>Source</th>
              <th style={{ padding: 8 }}>Job</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Opened</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={`${i.source}:${i.assignmentId}:${i.disputeId ?? ''}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{i.source === 'ops_review' ? 'Silence → ops' : 'Dispute'}</td>
                <td style={{ padding: 8 }}>{i.jobTitle}</td>
                <td style={{ padding: 8 }}>{i.status}</td>
                <td style={{ padding: 8, fontSize: 12, color: '#888' }}>
                  {new Date(i.openedAt).toLocaleString()}
                </td>
                <td style={{ padding: 8 }}>
                  <Link href={`/admin/workbench/${i.assignmentId}`} style={{ color: '#1f7a4d' }}>
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

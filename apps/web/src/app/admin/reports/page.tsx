// Reports ops queue (§9/§18): open reports grouped by target, with inline resolve.
// Surfaces the offender, how many distinct people flagged them, the worst reason, and
// the offender's accumulated fraud-signal weight — so a moderator can triage at a glance.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildClient, readAdminToken, writeAdminToken } from '../../../lib/api';
import { randomUUID } from '@kafil/core';

interface QueueItem {
  targetType: string;
  targetId: string;
  offenderId: string | null;
  offenderName: string | null;
  offenderStatus: string | null;
  offenderFraudWeight: number;
  reportCount: number;
  distinctReporters: number;
  topReason: string;
  latestAt: string;
}

const REASON_LABEL: Record<string, string> = {
  scam: 'Scam',
  fee_request: 'Asked to pay (F1)',
  fake: 'Fake',
  off_platform: 'Off-platform (F2)',
  harassment: 'Harassment',
  spam: 'Spam',
  other: 'Other',
};

function weightColor(w: number): string {
  if (w >= 160) return '#b23a2e';
  if (w >= 80) return '#c97a1f';
  return '#888';
}

export default function ReportsQueuePage() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = buildClient();
    const r = await c.get<{ ok: true; items: QueueItem[] }>('/api/admin/reports');
    if (r.success) setItems((r.data as { items: QueueItem[] }).items);
    else if (r.status === 401 || r.status === 403) {
      writeAdminToken(null);
      router.replace('/admin/login');
    } else {
      setError((r.data as { message?: string }).message ?? 'failed to load');
    }
  }, [router]);

  useEffect(() => {
    if (!readAdminToken()) {
      router.replace('/admin/login');
      return;
    }
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'network'));
  }, [router, load]);

  const resolve = async (
    item: QueueItem,
    decision: 'dismiss' | 'action',
    ban = false,
  ) => {
    const key = `${item.targetType}:${item.targetId}`;
    if (busyKey) return;
    if (ban && !window.confirm(`Ban ${item.offenderName ?? 'this user'}? This blocks their login.`)) return;
    setBusyKey(key);
    setError(null);
    const c = buildClient();
    const r = await c.post(
      '/api/admin/reports/resolve',
      { target_type: item.targetType, target_id: item.targetId, decision, ban },
      { idempotencyKey: randomUUID() },
    );
    if (r.success) {
      await load();
    } else {
      setError((r.data as { message?: string }).message ?? `failed (${r.status})`);
    }
    setBusyKey(null);
  };

  return (
    <main style={{ padding: 24, maxWidth: 1040, margin: '0 auto', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Reports</h1>
        <nav style={{ display: 'flex', gap: 16 }}>
          <a href="/admin/workbench" style={{ color: '#1f7a4d' }}>
            Workbench →
          </a>
          <button
            type="button"
            onClick={() => {
              writeAdminToken(null);
              router.replace('/admin/login');
            }}
            style={{ border: 0, background: 'transparent', color: '#1f7a4d', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </nav>
      </header>

      <p className="muted">
        Open reports grouped by what was reported (§9). Highest report-count first. The
        fraud weight is the offender&apos;s accumulated signal score — high weight + many
        distinct reporters is your strongest signal.
      </p>

      {error ? <p style={{ color: '#b23a2e' }}>{error}</p> : null}

      {items === null ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">No open reports. The bazaar is calm.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
              <th style={{ padding: 8 }}>Target</th>
              <th style={{ padding: 8 }}>Offender</th>
              <th style={{ padding: 8 }}>Top reason</th>
              <th style={{ padding: 8 }}>Reports</th>
              <th style={{ padding: 8 }}>Fraud wt.</th>
              <th style={{ padding: 8 }}>Latest</th>
              <th style={{ padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const key = `${i.targetType}:${i.targetId}`;
              const busy = busyKey === key;
              return (
                <tr key={key} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}>
                    <code style={{ fontSize: 12 }}>{i.targetType}</code>
                    <div style={{ fontSize: 11, color: '#aaa' }}>{i.targetId.slice(0, 8)}…</div>
                  </td>
                  <td style={{ padding: 8 }}>
                    {i.offenderName ?? <span className="muted">—</span>}
                    {i.offenderStatus && i.offenderStatus !== 'active' ? (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#b23a2e' }}>
                        ({i.offenderStatus})
                      </span>
                    ) : null}
                  </td>
                  <td style={{ padding: 8 }}>{REASON_LABEL[i.topReason] ?? i.topReason}</td>
                  <td style={{ padding: 8 }}>
                    {i.reportCount}
                    <span style={{ color: '#aaa', fontSize: 12 }}> ({i.distinctReporters} ppl)</span>
                  </td>
                  <td style={{ padding: 8, color: weightColor(i.offenderFraudWeight), fontWeight: 600 }}>
                    {i.offenderFraudWeight}
                  </td>
                  <td style={{ padding: 8, fontSize: 12, color: '#888' }}>
                    {new Date(i.latestAt).toLocaleString()}
                  </td>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => resolve(i, 'dismiss')}
                      style={btnStyle('#888', busy)}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => resolve(i, 'action')}
                      style={btnStyle('#1f7a4d', busy)}
                    >
                      Action
                    </button>
                    {i.targetType === 'user' && i.offenderId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resolve(i, 'action', true)}
                        style={btnStyle('#b23a2e', busy)}
                      >
                        Action + ban
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

function btnStyle(color: string, busy: boolean): React.CSSProperties {
  return {
    marginRight: 6,
    padding: '4px 10px',
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    borderRadius: 4,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.5 : 1,
    fontSize: 12,
  };
}

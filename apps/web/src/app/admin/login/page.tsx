// Minimal admin "login" — paste a Bearer token. Real OTP-based admin login + role
// elevation lands later. For now this is enough for ops staff with a CLI-obtained JWT.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readAdminToken, writeAdminToken } from '../../../lib/api';

export default function AdminLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (readAdminToken()) {
      router.replace('/admin/workbench');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    if (!t) {
      setError('paste a token');
      return;
    }
    writeAdminToken(t);
    router.push('/admin/workbench');
  };

  return (
    <main style={{ padding: 40, maxWidth: 520, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>Admin login</h1>
      <p className="muted">
        Paste a Bearer access token for an account with the <code>admin</code>,{' '}
        <code>moderator</code>, or <code>support</code> role.
      </p>
      <form onSubmit={onSubmit}>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={4}
          style={{
            width: '100%',
            padding: 12,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            borderRadius: 10,
            border: '1px solid #ccc',
          }}
          placeholder="eyJhbGciOi…"
        />
        {error ? <p style={{ color: '#b23a2e' }}>{error}</p> : null}
        <button type="submit" className="btn" style={{ marginTop: 12 }}>
          Sign in
        </button>
      </form>
    </main>
  );
}

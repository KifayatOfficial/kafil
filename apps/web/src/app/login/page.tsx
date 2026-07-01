'use client';

// Web OTP login — the same phone → OTP → token flow the mobile app uses. On success it
// posts the access token to /api/session, which stores it in an httpOnly cookie; from
// then on server actions act as the real user (chat-send, profile-edit, etc.).
//
// Dev note: the API's ConsoleSmsProvider logs the OTP to the API server console, so in
// this environment you read the code from the API logs (no real SMS is sent).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Stable-ish per-browser fingerprint (persisted). Not a hardware id — good enough for the
// web shell; the API only requires an 8–128 char string.
function deviceFingerprint(): string {
  const KEY = 'kafil.web.fp';
  let fp = localStorage.getItem(KEY);
  if (!fp) {
    fp = `web-${Math.abs(hashString(navigator.userAgent + navigator.language)).toString(36)}-${Date.now().toString(36)}`;
    localStorage.setItem(KEY, fp);
  }
  return fp;
}
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [rawPhone, setRawPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const digits = rawPhone.replace(/\D/g, '').slice(0, 10);
  const e164 = digits.length === 10 ? `+92${digits}` : '';

  async function requestOtp() {
    if (!e164) return setError('Enter a 10-digit Pakistani mobile number.');
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_e164: e164, device_fingerprint: deviceFingerprint() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message ?? data.code ?? 'Could not send code');
      setStep('otp');
      setNote('Code sent. In dev, read it from the API server logs.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code.');
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_e164: e164, otp, device_fingerprint: deviceFingerprint() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message ?? data.code ?? 'Invalid code');
      const token = data.value?.accessToken as string | undefined;
      const refreshToken = data.value?.refreshToken as string | undefined;
      if (!token) throw new Error('No token returned');
      // Hand both tokens to the web server, which stores them in httpOnly cookies (the
      // refresh token powers silent re-auth when the access token expires).
      const s = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, refreshToken }),
      });
      if (!s.ok) throw new Error('Could not start session');
      router.push('/profile');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verify failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>ك</span>
          <div>
            <div className="brand-name">کافل</div>
            <div className="brand-tag">Sign in</div>
          </div>
        </div>
        <a href="/" className="nav-link">← Back</a>
      </header>
      <main className="container" style={{ maxWidth: 440 }}>
        <div className="section-head"><h2>{step === 'phone' ? 'Sign in with your phone' : 'Enter the code'}</h2></div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {step === 'phone' ? (
            <>
              <label className="muted">Pakistani mobile number</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="chip">+92</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="3XX XXX XXXX"
                  value={rawPhone}
                  onChange={(e) => setRawPhone(e.target.value)}
                />
              </div>
              <button className="btn" onClick={requestOtp} disabled={busy || !e164}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </>
          ) : (
            <>
              <label className="muted">6-digit code sent to {e164}</label>
              <input
                className="input"
                inputMode="numeric"
                placeholder="______"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              />
              <button className="btn" onClick={verifyOtp} disabled={busy || otp.length !== 6}>
                {busy ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setStep('phone'); setOtp(''); setError(null); }}>
                ← Change number
              </button>
            </>
          )}
          {note ? <span className="muted">{note}</span> : null}
          {error ? <span className="form-err">{error}</span> : null}
        </div>
      </main>
    </div>
  );
}

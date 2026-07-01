// Web session cookie endpoint (Next route handler, runs on the web server).
//   POST { token, refreshToken? }  → set httpOnly access (+ refresh) cookies after OTP
//   DELETE                          → clear both (logout)
//
// Tokens are minted by the KAFIL API's OTP flow; this only stores them server-side in
// httpOnly cookies so server actions can read them and XSS cannot. Refresh rotation is
// handled in lib/session (authedFetch/tryRefresh).

import { NextResponse } from 'next/server';
import { setSessionTokens, clearSession } from '../../../lib/session';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; refreshToken?: string };
  const token = body.token?.trim();
  if (!token) return NextResponse.json({ ok: false, message: 'token required' }, { status: 400 });
  await setSessionTokens(token, body.refreshToken?.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}

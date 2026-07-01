// Web session cookie endpoint (Next route handler, runs on the web server).
//   POST { token }  → set the httpOnly auth cookie (called after a successful OTP verify)
//   DELETE          → clear it (logout)
//
// The token itself is minted by the KAFIL API's OTP flow; this only stores it server-side
// in an httpOnly cookie so server actions can read it and XSS cannot.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { AUTH_COOKIE } from '../../../lib/session';

// Access tokens are short-lived (~15 min); the cookie mirrors a session's practical life.
// A production build pairs this with refresh-token rotation; for the shell we keep it
// simple and re-login on expiry.
const MAX_AGE = 60 * 60 * 8; // 8h

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = body.token?.trim();
  if (!token) return NextResponse.json({ ok: false, message: 'token required' }, { status: 400 });

  const jar = await cookies();
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
  return NextResponse.json({ ok: true });
}

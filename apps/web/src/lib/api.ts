// Web-side wrapper around @kafil/core's KafilApiClient. Reads the bearer token from
// a cookie (set by the admin login) and falls back to localStorage for dev. Real admin
// auth lands in a later round; for v0 the token is pasted by the operator.

import { KafilApiClient } from '@kafil/core';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'kafil.adminToken';

export function readAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function writeAdminToken(t: string | null): void {
  if (typeof window === 'undefined') return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function buildClient(): KafilApiClient {
  return new KafilApiClient({
    baseUrl: API_URL,
    getAccessToken: () => readAdminToken(),
  });
}

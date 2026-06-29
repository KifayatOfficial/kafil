import { NextResponse } from 'next/server';
import { authService } from '../../../../services/auth.service';
import { statusFor } from '../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { refresh_token?: string };
  if (!body.refresh_token) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'refresh_token required' },
      { status: 400 },
    );
  }
  const res = await authService.refresh(body.refresh_token);
  const status = res.ok ? 200 : statusFor(res.code);
  return NextResponse.json(res, { status });
}

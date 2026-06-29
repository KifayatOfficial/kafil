import { NextResponse } from 'next/server';
import { authService } from '../../../../../services/auth.service';
import { statusFor } from '../../../../../lib/result';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await authService.verifyOtp(body);
  const status = res.ok ? 200 : statusFor(res.code);
  return NextResponse.json(res, { status });
}

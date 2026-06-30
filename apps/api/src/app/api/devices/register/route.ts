// POST /api/devices/register — store this device's push token (§11).
// The mobile app calls this after the user grants notification permission and Expo/FCM
// returns a token. Keyed by (userId, device_fingerprint) so a token refresh updates the
// existing device row rather than spawning duplicates. Body: { device_fingerprint, push_token }.
import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const body = (await req.json()) as { device_fingerprint?: string; push_token?: string };
  if (!body.device_fingerprint || !body.push_token) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'device_fingerprint and push_token are required' },
      { status: 400 },
    );
  }

  // Update the existing device row for this (user, fingerprint); create it if the
  // device hasn't been seen yet (e.g. token granted before the first auth heartbeat).
  // Re-registering a token flips status back to 'active' (§24/C7) — a reinstall that
  // previously hard-bounced should resume receiving pushes.
  const existing = await prisma.device.findFirst({
    where: { userId: actor.userId, deviceFingerprint: body.device_fingerprint },
    select: { id: true },
  });
  if (existing) {
    await prisma.device.update({
      where: { id: existing.id },
      data: { pushToken: body.push_token, pushTokenStatus: 'active', lastSeenAt: new Date() },
    });
  } else {
    await prisma.device.create({
      data: {
        userId: actor.userId,
        deviceFingerprint: body.device_fingerprint,
        pushToken: body.push_token,
        pushTokenStatus: 'active',
        lastSeenAt: new Date(),
      },
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

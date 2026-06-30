// GET /api/discovery/nearby — unified "what's near me" across jobs + shops + groups.
// Query: ?lat&lng (optional — falls back to the caller's base location), ?radius_m,
// ?kinds=job,shop,group (optional filter).
import { NextResponse } from 'next/server';
import { discoveryService } from '../../../../services/discovery.service';
import { statusFor } from '../../../../lib/result';
import { getActorOrDevStub } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const latRaw = q.get('lat');
  const lngRaw = q.get('lng');
  const radiusRaw = q.get('radius_m');
  const kindsRaw = q.get('kinds');
  const validKinds = ['job', 'shop', 'group'] as const;
  const kinds = kindsRaw
    ? (kindsRaw.split(',').map((k) => k.trim()).filter((k): k is typeof validKinds[number] => (validKinds as readonly string[]).includes(k)))
    : undefined;

  const res = await discoveryService.nearby({
    userId: actor.userId,
    lat: latRaw != null ? Number(latRaw) : undefined,
    lng: lngRaw != null ? Number(lngRaw) : undefined,
    radiusM: radiusRaw != null ? Number(radiusRaw) : undefined,
    kinds,
  });
  if (!res.ok) return NextResponse.json(res, { status: statusFor(res.code) });
  return NextResponse.json({ ok: true, ...res.value });
}

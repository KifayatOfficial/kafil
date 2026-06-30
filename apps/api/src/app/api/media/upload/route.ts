// POST /api/media/upload — upload an image, get back a URL to attach to a post, shop
// photo, job photo, or profile photo. Accepts multipart/form-data (field "file") OR a
// JSON body { content_type, data_base64 } — the JSON form is friendlier for the mobile
// client on flaky 2G (it rides the same JSON request path as everything else).
import { NextResponse } from 'next/server';
import { storageProvider, StorageError } from '../../../../providers/storage.provider';
import { getActorOrDevStub } from '../../../../lib/auth';
import { emitEvent } from '../../../../lib/events';
import { prisma } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const actor = await getActorOrDevStub(req);
  if (!actor) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

  const contentTypeHeader = req.headers.get('content-type') ?? '';
  let bytes: Buffer;
  let contentType: string;
  let kind = 'media';

  try {
    if (contentTypeHeader.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ ok: false, code: 'VALIDATION', message: 'file field required' }, { status: 400 });
      }
      bytes = Buffer.from(await file.arrayBuffer());
      contentType = file.type || 'application/octet-stream';
      kind = (form.get('kind') as string) || 'media';
    } else {
      const body = (await req.json()) as { content_type?: string; data_base64?: string; kind?: string };
      if (!body.content_type || !body.data_base64) {
        return NextResponse.json({ ok: false, code: 'VALIDATION', message: 'content_type and data_base64 required' }, { status: 400 });
      }
      bytes = Buffer.from(body.data_base64, 'base64');
      contentType = body.content_type;
      kind = body.kind || 'media';
    }
  } catch {
    return NextResponse.json({ ok: false, code: 'VALIDATION', message: 'malformed upload' }, { status: 400 });
  }

  try {
    const stored = await storageProvider.put({ bytes, contentType, kind });
    await emitEvent(prisma, {
      eventType: 'media.uploaded',
      actorId: actor.userId,
      refType: 'media',
      refId: null,
      payload: { kind, bytes: stored.bytes, content_type: stored.contentType, exif_stripped: storageProvider.stripsExif },
    });
    return NextResponse.json({ ok: true, url: stored.url, bytes: stored.bytes }, { status: 201 });
  } catch (e) {
    if (e instanceof StorageError) {
      const code = e.code === 'TOO_LARGE' ? 413 : 400;
      return NextResponse.json({ ok: false, code: 'VALIDATION', message: e.message }, { status: code });
    }
    throw e;
  }
}

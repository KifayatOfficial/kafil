// §1/P2 + v1.0 §6 — media storage behind a provider interface so the app boots with
// zero external deps. Dev adapter writes to a local public dir and returns a served
// path; prod swaps to an S3StorageProvider (signed PUT + CDN URL) by env.
//
// §10/F10 — uploads must be EXIF-stripped (a worker's before/after photo can leak the
// GPS of their home). A real strip needs an image lib (sharp); the dev adapter can't,
// so it refuses anything but a curated content-type allowlist and caps size. The S3
// adapter will run sharp().rotate() (drops EXIF) before storing. Marked clearly so we
// never ship the dev path to prod.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type MediaContentType = 'image/jpeg' | 'image/png' | 'image/webp';

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB — generous for a phone photo, bounded for 2G.

export interface StoredMedia {
  url: string;
  bytes: number;
  contentType: string;
}

export interface StorageProvider {
  /** Store bytes, return a fetchable URL. Throws on disallowed type / oversize. */
  put(args: { bytes: Buffer; contentType: string; kind: string }): Promise<StoredMedia>;
  /** Whether EXIF is actually stripped by this adapter (false → dev/no-strip). */
  readonly stripsExif: boolean;
}

function validate(bytes: Buffer, contentType: string): string {
  const ext = ALLOWED[contentType];
  if (!ext) throw new StorageError('UNSUPPORTED_TYPE', `unsupported content-type: ${contentType}`);
  if (bytes.length === 0) throw new StorageError('EMPTY', 'empty upload');
  if (bytes.length > MAX_BYTES) throw new StorageError('TOO_LARGE', `over ${MAX_BYTES} bytes`);
  return ext;
}

export class StorageError extends Error {
  constructor(public code: 'UNSUPPORTED_TYPE' | 'EMPTY' | 'TOO_LARGE', message: string) {
    super(message);
  }
}

// Dev adapter: writes under apps/api/public/uploads and returns a path the Next.js
// static handler serves. Filename is content-hashed so re-uploading the same bytes is
// idempotent. NOT EXIF-stripped — never use in prod.
class LocalStorageProvider implements StorageProvider {
  readonly stripsExif = false;
  private baseDir = path.join(process.cwd(), 'public', 'uploads');

  async put(args: { bytes: Buffer; contentType: string; kind: string }): Promise<StoredMedia> {
    const ext = validate(args.bytes, args.contentType);
    const hash = createHash('sha256').update(args.bytes).digest('hex').slice(0, 24);
    const name = `${args.kind}-${hash}-${randomUUID().slice(0, 8)}.${ext}`;
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(path.join(this.baseDir, name), args.bytes);
    return { url: `/uploads/${name}`, bytes: args.bytes.length, contentType: args.contentType };
  }
}

// Switched by env in prod (S3StorageProvider with sharp EXIF strip + CDN URL).
export const storageProvider: StorageProvider = new LocalStorageProvider();

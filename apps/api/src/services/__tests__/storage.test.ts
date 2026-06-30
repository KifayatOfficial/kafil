// §10/F10 + v1.0 §6 — storage provider tests. Pure (no DB): validate the type/size
// guards and that a stored image returns a served URL.

import { afterAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { storageProvider, StorageError } from '../../providers/storage.provider';

afterAll(async () => {
  // Clean up anything the local adapter wrote during the test.
  await rm(path.join(process.cwd(), 'public', 'uploads'), { recursive: true, force: true }).catch(() => undefined);
});

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

describe('storage provider', () => {
  it('stores an allowed image and returns a served URL', async () => {
    const r = await storageProvider.put({ bytes: tinyPng, contentType: 'image/png', kind: 'post' });
    expect(r.url).toMatch(/^\/uploads\/post-.+\.png$/);
    expect(r.bytes).toBe(tinyPng.length);
  });

  it('rejects an unsupported content type', async () => {
    await expect(
      storageProvider.put({ bytes: Buffer.from('hi'), contentType: 'application/pdf', kind: 'post' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('rejects an empty upload', async () => {
    await expect(
      storageProvider.put({ bytes: Buffer.alloc(0), contentType: 'image/jpeg', kind: 'post' }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('rejects an oversize upload', async () => {
    const big = Buffer.alloc(7 * 1024 * 1024, 1);
    await expect(
      storageProvider.put({ bytes: big, contentType: 'image/jpeg', kind: 'post' }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});

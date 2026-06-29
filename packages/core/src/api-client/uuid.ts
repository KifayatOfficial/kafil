// UUID v4 generator. Uses crypto.randomUUID() where available (Node 19+, all modern
// browsers, React Native 0.74 with Hermes). Falls back to Math.random()-based
// generation only as a last resort — adequate for an idempotency key.

export function randomUUID(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();

  // RFC4122 v4 fallback.
  const bytes = new Uint8Array(16);
  if (g.crypto && 'getRandomValues' in g.crypto) {
    (g.crypto as Crypto).getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

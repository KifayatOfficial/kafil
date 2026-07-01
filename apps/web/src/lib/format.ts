// Small formatting helpers shared across pages.

/** Relative "time ago" for timestamps — "just now", "5m", "3h", "2d", or a date. */
export function timeAgo(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const then = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(then).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** PKR with thousands separators. */
export const pkr = (n: number) => new Intl.NumberFormat('en-PK').format(n);

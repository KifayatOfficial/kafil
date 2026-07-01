// Platform top nav — the three pillars (Jobs · Shops · Community) that the mobile app
// reaches via its screens. On the desktop/admin shell they're pages, so this is a simple
// server-rendered nav highlighting the active section. Icon + label so it reads at a
// glance (mirrors the low-literacy iconography of the app).

const LINKS = [
  { href: '/', label: 'Work', glyph: '🧰' },
  { href: '/shops', label: 'Shops', glyph: '🏪' },
  { href: '/community', label: 'Community', glyph: '🏘️' },
  { href: '/nearby', label: 'Nearby', glyph: '📍' },
  { href: '/messages', label: 'Messages', glyph: '💬' },
  { href: '/profile', label: 'Profile', glyph: '👤' },
] as const;

type NavHref = (typeof LINKS)[number]['href'];

export function TopNav({ active }: { active: NavHref }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ك
        </span>
        <div>
          <div className="brand-name">کافل</div>
          <div className="brand-tag">Desktop / admin · Mobile is primary (§23)</div>
        </div>
      </div>
      <nav className="nav">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={`nav-link${l.href === active ? ' nav-link-active' : ''}`}>
            <span aria-hidden>{l.glyph}</span> {l.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

// Platform top nav — the three pillars (Jobs · Shops · Community) that the mobile app
// reaches via its screens. Server-rendered; highlights the active section and shows
// Sign in / Sign out based on the real session cookie. Icon + label so it reads at a
// glance (mirrors the low-literacy iconography of the app).

import { isSignedIn } from '../lib/session';
import { SignOutButton } from './SignOutButton';

const LINKS = [
  { href: '/', label: 'Work', glyph: '🧰' },
  { href: '/shops', label: 'Shops', glyph: '🏪' },
  { href: '/community', label: 'Community', glyph: '🏘️' },
  { href: '/nearby', label: 'Nearby', glyph: '📍' },
  { href: '/messages', label: 'Messages', glyph: '💬' },
  { href: '/profile', label: 'Profile', glyph: '👤' },
] as const;

type NavHref = (typeof LINKS)[number]['href'];

export async function TopNav({ active }: { active: NavHref }) {
  const signedIn = await isSignedIn();
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
        <form action="/search" className="nav-search" role="search">
          <input name="q" className="nav-search-input" placeholder="🔎 Search…" aria-label="Search" />
        </form>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={`nav-link${l.href === active ? ' nav-link-active' : ''}`}>
            <span aria-hidden>{l.glyph}</span> {l.label}
          </a>
        ))}
        {signedIn ? <SignOutButton /> : <a href="/login" className="nav-link nav-link-active">Sign in</a>}
      </nav>
    </header>
  );
}

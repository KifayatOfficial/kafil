// Platform top nav — the three pillars (Jobs · Shops · Community) that the mobile app
// reaches via its screens. Server-rendered; highlights the active section and shows
// Sign in / Sign out based on the real session cookie. Icon + label so it reads at a
// glance (mirrors the low-literacy iconography of the app).

import type { SVGProps } from 'react';
import { isSignedIn } from '../lib/session';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
import { IconWork, IconShop, IconCommunity, IconNearby, IconMessages, IconProfile } from './icons';

type IconType = (p: SVGProps<SVGSVGElement> & { size?: number }) => React.ReactElement;

const LINKS: ReadonlyArray<{ href: string; label: string; Icon: IconType }> = [
  { href: '/', label: 'Work', Icon: IconWork },
  { href: '/shops', label: 'Shops', Icon: IconShop },
  { href: '/community', label: 'Community', Icon: IconCommunity },
  { href: '/nearby', label: 'Nearby', Icon: IconNearby },
  { href: '/messages', label: 'Messages', Icon: IconMessages },
  { href: '/profile', label: 'Profile', Icon: IconProfile },
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
        {LINKS.map((l) => {
          const activeLink = l.href === active;
          return (
            <a key={l.href} href={l.href} className={`nav-link${activeLink ? ' nav-link-active' : ''}`}>
              <l.Icon size={17} aria-hidden />
              <span>{l.label}</span>
            </a>
          );
        })}
        <ThemeToggle />
        {signedIn ? <SignOutButton /> : <a href="/login" className="nav-link nav-link-active">Sign in</a>}
      </nav>
    </header>
  );
}

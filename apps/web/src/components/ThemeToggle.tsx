'use client';

// Web theme toggle — mirrors the mobile app's 🌗 control. Cycles system → light → dark,
// writes the choice to localStorage, and sets data-theme on <html> so globals.css picks
// it up. 'system' removes the attribute so the OS prefers-color-scheme media query rules.
// The no-flash inline script in layout.tsx applies the saved choice before first paint.

import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const GLYPH: Record<Mode, string> = { system: '🌗', light: '☀️', dark: '🌙' };
const ORDER: Mode[] = ['system', 'light', 'dark'];
const KEY = 'kafil.theme';

function apply(mode: Mode) {
  const el = document.documentElement;
  if (mode === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', mode);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');

  // Hydrate from the attribute the inline script already set (avoids a flash/mismatch).
  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Mode | null) ?? 'system';
    setMode(saved);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    setMode(next);
    localStorage.setItem(KEY, next);
    apply(next);
  };

  return (
    <button
      type="button"
      className="nav-link theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${mode}`}
      title={`Theme: ${mode} (tap to change)`}
    >
      {GLYPH[mode]}
    </button>
  );
}

'use client';

// Clears the httpOnly session cookie (DELETE /api/session) and refreshes so the server
// re-renders as signed-out.

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="nav-link"
      onClick={async () => {
        await fetch('/api/session', { method: 'DELETE' });
        router.push('/');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

'use client';

// One-tap "Join" for a group card — a minimal form bound to joinGroupAction. Shows a
// pending state and flips to a success chip after joining (the page also revalidates, so
// a refresh reflects the new member count + joined flag).

import { useActionState } from 'react';
import { joinGroupAction, type ActionResult } from '../app/actions';

export function JoinButton({ groupId }: { groupId: string }) {
  const [state, formAction, pending] = useActionState(joinGroupAction, null as ActionResult | null);
  if (state?.ok) return <span className="chip chip-rate">✓ Joined</span>;
  return (
    <form action={formAction} style={{ display: 'inline' }}>
      <input type="hidden" name="groupId" value={groupId} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? 'Joining…' : 'Join'}
      </button>
      {state && !state.ok ? <span className="form-err" style={{ marginInlineStart: 8 }}>{state.message}</span> : null}
    </form>
  );
}

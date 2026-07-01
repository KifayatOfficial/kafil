'use client';

// A small client wrapper around a server action: renders children (the inputs), a submit
// button that shows pending state, and the action's ok/error message. Collapsible so it
// doesn't dominate the page — a "＋ New" toggle opens it.

import { useActionState, useState, type ReactNode } from 'react';
import type { ActionResult } from '../app/actions';

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function QuickForm({
  action,
  submitLabel,
  openLabel,
  children,
}: {
  action: Action;
  submitLabel: string;
  openLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="quickform-wrap">
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        {open ? '✕ Close' : openLabel}
      </button>
      {open ? (
        <form action={formAction} className="card quickform">
          {children}
          <div className="quickform-foot">
            <button type="submit" className="btn" disabled={pending}>
              {pending ? 'Saving…' : submitLabel}
            </button>
            {state ? (
              <span className={state.ok ? 'form-ok' : 'form-err'}>{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

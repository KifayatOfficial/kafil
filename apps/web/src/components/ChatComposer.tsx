'use client';

// Chat send box — REAL AUTH only (the send endpoint requires a signed-in participant,
// and the API redacts PII server-side per §5). Uses the sendMessageAction; on success the
// page revalidates and the new message appears in the thread.

import { useActionState, useRef, useEffect } from 'react';
import { sendMessageAction, type ActionResult } from '../app/actions';

export function ChatComposer({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState(sendMessageAction, null as ActionResult | null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the input after a successful send.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="composer">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input name="body" className="input" placeholder="Type a message…" maxLength={4000} autoComplete="off" />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? '…' : 'Send'}
      </button>
      {state && !state.ok ? <span className="form-err">{state.message}</span> : null}
    </form>
  );
}

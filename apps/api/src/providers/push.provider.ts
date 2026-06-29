// PushProvider (§11) — sends a transactional push to a device's FCM/APNs token.
// Real implementation later via `firebase-admin` (FCM) + APNs. Console adapter logs
// the payload so dev/CI keeps working with no external account.

export interface PushPayload {
  title: string;
  body: string;
  /** Server-side data the client opens to; e.g. {kind: 'chat', conversationId} */
  data?: Record<string, string>;
  /** §11/§26/M13 priority — bypasses quiet hours for 'urgent'. */
  priority: 'urgent' | 'transactional' | 'engagement' | 'promo';
}

export interface PushResult {
  ok: boolean;
  providerRef?: string;
  /** When the token is no longer valid (uninstall / new app install) the caller
   *  must flip Device.pushTokenStatus to 'inactive' (§24/C7). */
  tokenInvalid?: boolean;
  costMinor?: number;
  error?: string;
}

export interface PushProvider {
  send(token: string, payload: PushPayload): Promise<PushResult>;
}

class ConsolePushProvider implements PushProvider {
  async send(token: string, payload: PushPayload): Promise<PushResult> {
    // eslint-disable-next-line no-console
    console.log(
      `[push/console] → ${token.slice(0, 12)}…  ${payload.priority.toUpperCase()}  ${payload.title}: ${payload.body}`,
    );
    return { ok: true, providerRef: `console:${Date.now()}` };
  }
}

export const pushProvider: PushProvider = new ConsolePushProvider();

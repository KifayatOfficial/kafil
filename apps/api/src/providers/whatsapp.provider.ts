// WhatsApp provider (§11). Real WhatsApp Business API has strict constraints v1.0 missed:
//   - Pre-approved templates only outside the 24h user-initiated session window.
//   - Explicit opt-in required (§11) — NotificationsService gates this; we just send.
//   - Per-message cost, quality tiers, rate limits.
//
// This interface intentionally takes a `template_id` because that's the prod contract.
// Free-form `body` is NOT supported here — the service layer chooses a template.
//
// Console adapter logs the would-be send for local/CI use.

export interface WhatsAppPayload {
  /** Pre-approved template id (e.g. "job_match_v1"). */
  templateId: string;
  /** Template variable substitutions (template-defined order). */
  vars: string[];
  /** Locale for the template (ps, ur, en). */
  locale: 'ps' | 'ur' | 'en';
}

export interface WhatsAppResult {
  ok: boolean;
  providerRef?: string;
  costMinor?: number;
  /** True when the template/locale combo isn't approved on this account. */
  templateMissing?: boolean;
  /** True when user has blocked the business or revoked opt-in upstream. */
  optedOut?: boolean;
  error?: string;
}

export interface WhatsAppProvider {
  sendTemplate(phoneE164: string, payload: WhatsAppPayload): Promise<WhatsAppResult>;
}

class ConsoleWhatsAppProvider implements WhatsAppProvider {
  async sendTemplate(phoneE164: string, payload: WhatsAppPayload): Promise<WhatsAppResult> {
    // eslint-disable-next-line no-console
    console.log(
      `[wa/console] → ${phoneE164}  template=${payload.templateId} (${payload.locale}) vars=${JSON.stringify(payload.vars)}`,
    );
    // Pretend it costs PKR 1.50 — real Twilio/Meta pricing varies.
    return { ok: true, providerRef: `wa-console:${Date.now()}`, costMinor: 150 };
  }
}

export const whatsappProvider: WhatsAppProvider = new ConsoleWhatsAppProvider();

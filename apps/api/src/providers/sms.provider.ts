// §1/P2 — provider interface so the app boots offline. Real Twilio adapter later.
export interface SmsProvider {
  sendOtp(phoneE164: string, otp: string): Promise<{ providerRef?: string }>;
}

class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phoneE164: string, otp: string) {
    // eslint-disable-next-line no-console
    console.log(`[sms/console] → ${phoneE164}: KAFIL OTP is ${otp}`);
    return { providerRef: `console:${Date.now()}` };
  }
}

// Future: TwilioSmsProvider, JazzCashSmsProvider, etc. Switched by env (P2).
export const smsProvider: SmsProvider = new ConsoleSmsProvider();

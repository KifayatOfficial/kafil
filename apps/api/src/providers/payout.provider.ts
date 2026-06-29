// §6/§2.9 — PayoutProvider interface so outbound money has a swappable adapter.
// Dev uses the console adapter (no real disbursement); prod swaps in JazzCash /
// Easypaisa adapters (P2). The reconciliation job matches provider_ref ↔ payouts.

export interface PayoutResult {
  ok: boolean;
  providerRef?: string;
  /** Provider-side failure reason (e.g. invalid wallet, limit). */
  failure?: string;
}

export interface PayoutProvider {
  /** Disburse `amountMinor` paisa to the worker's payout destination (phone wallet). */
  send(args: {
    phoneE164: string;
    amountMinor: bigint;
    payoutId: string;
  }): Promise<PayoutResult>;
}

class ConsolePayoutProvider implements PayoutProvider {
  async send(args: { phoneE164: string; amountMinor: bigint; payoutId: string }): Promise<PayoutResult> {
    // eslint-disable-next-line no-console
    console.log(
      `[payout/console] → ${args.phoneE164}: ${args.amountMinor.toString()} paisa (payout ${args.payoutId})`,
    );
    return { ok: true, providerRef: `console:${args.payoutId}` };
  }
}

// Switched by env in prod (P2): JazzCashPayoutProvider / EasypaisaPayoutProvider.
// Mutable so prod can install a real adapter at startup and tests can simulate a
// provider failure; default is the console adapter.
let active: PayoutProvider = new ConsolePayoutProvider();

export const payoutProvider: PayoutProvider = {
  send: (args) => active.send(args),
};

/** Install a provider (prod startup / tests). Returns the previous one for restore. */
export function setPayoutProvider(p: PayoutProvider): PayoutProvider {
  const prev = active;
  active = p;
  return prev;
}

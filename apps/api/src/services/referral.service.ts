// §10 F7 — referral program with anti-farming.
//
// The spec's whole point about referrals is the abuse model, not the bounty: PK job
// markets get self-referrals and fake-signup farms in week one. So the design is:
//   - Reward is paid on the referred user's FIRST COMPLETED JOB, never on signup.
//     A fake account that never works earns nothing — the farm has no payout surface.
//   - One referral per referred user (you can't be referred twice).
//   - You cannot refer yourself.
//   - Same-device referrer/referred → recorded as a fraud signal and the referral is
//     marked rejected_fraud (no reward), per F3/F7.
//   - A per-referrer daily velocity cap blunts mass-claim scripts.
//   - The reward moves platform_revenue → referrer wallet as a balanced ledger txn in
//     the same transaction that flips the referral to 'qualified' (P3).

import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { referralRepository } from '../repositories/referral.repository';
import { safetyRepository } from '../repositories/safety.repository';
import { ensureWallet, writeLedgerTxn } from './ledger';

// Tunables (read from `settings`, with conservative fallbacks).
const DEFAULT_REWARD_MINOR = 30_000; // 300 PKR (§10 F7) — matches the seeded setting
const DEFAULT_DAILY_CLAIM_CAP = 20; // referrer can't claim more than N referred signups/day
const SELF_REFERRAL_SAME_DEVICE_WEIGHT = 50; // high — near-certain abuse (F3)

async function loadInt(key: string, fallback: number): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key } });
  const v = s?.value as number | null | undefined;
  return typeof v === 'number' ? v : fallback;
}

/** A short, unambiguous code. Avoids 0/O/1/I/l to be readable when spoken/typed. */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = 'K'; // KAFIL prefix so a code is recognizable when shared in WhatsApp
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Allocate a code not currently in use. `code` is unique across ALL referral rows
 * (the schema constraint), so both the shareable template row and each per-claim row
 * need their own. Returns null if we somehow can't find a free code in a few tries.
 */
async function allocateUniqueCode(): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    if (!(await referralRepository.findByCode(code))) return code;
  }
  return null;
}

export const referralService = {
  /**
   * The caller's stable shareable code (created on first call, returned thereafter).
   * This is the `referredId = null` template row; each successful claim copies the code
   * into a new row bound to the referred user.
   */
  async getOrCreateMyCode(userId: string): Promise<Result<{ code: string }>> {
    const existing = await referralRepository.findShareableByReferrer(userId);
    if (existing) return ok({ code: existing.code });

    // Allocate a free code and persist the template row. On a rare unique race we
    // re-read the now-existing template rather than failing.
    const code = await allocateUniqueCode();
    if (!code) return err('INTERNAL', 'could not allocate a referral code');
    try {
      const row = await prisma.$transaction((tx) =>
        referralRepository.create(tx, { referrerId: userId, code, status: 'template' }),
      );
      return ok({ code: row.code });
    } catch {
      const reread = await referralRepository.findShareableByReferrer(userId);
      if (reread) return ok({ code: reread.code });
      return err('INTERNAL', 'could not allocate a referral code');
    }
  },

  /** The caller's referral dashboard: their code + the referrals they've made. */
  async listMine(userId: string): Promise<
    Result<{
      code: string | null;
      referrals: Array<{ id: string; status: string; rewardMinor: number | null; createdAt: Date }>;
      totalRewardMinor: number;
      /** True if this user has already claimed someone's code — hides the claim box. */
      claimed: boolean;
    }>
  > {
    const template = await referralRepository.findShareableByReferrer(userId);
    const rows = await referralRepository.listByReferrer(userId);
    const claims = rows.filter((r) => r.referredId);
    const totalRewardMinor = claims
      .filter((r) => r.status === 'qualified')
      .reduce((acc, r) => acc + (r.rewardMinor ?? 0), 0);
    const myClaim = await referralRepository.findClaimByReferred(userId);
    return ok({
      code: template?.code ?? null,
      referrals: claims.map((r) => ({
        id: r.id,
        status: r.status,
        rewardMinor: r.rewardMinor,
        createdAt: r.createdAt,
      })),
      totalRewardMinor,
      claimed: !!myClaim,
    });
  },

  /**
   * A new (or not-yet-referred) user claims a referral code. Validates the anti-farming
   * rules and creates a `pending` claim. Reward is NOT paid here — it's paid when this
   * user completes their first job (see qualifyOnFirstCompletion).
   */
  async claim(args: {
    referredUserId: string;
    code: string;
    deviceFingerprint?: string | null;
  }): Promise<Result<{ status: 'pending' }>> {
    const code = args.code.trim().toUpperCase();
    if (!code) return err('VALIDATION', 'a referral code is required');

    const template = await referralRepository.findByCode(code);
    if (!template) return err('NOT_FOUND', 'that referral code does not exist');

    // Can't refer yourself.
    if (template.referrerId === args.referredUserId) {
      return err('CONFLICT', 'you cannot use your own referral code');
    }

    // One referral per referred user.
    if (await referralRepository.findClaimByReferred(args.referredUserId)) {
      return err('CONFLICT', 'you have already used a referral code');
    }

    // Velocity cap: blunt mass-claim scripts against one referrer.
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const recent = await referralRepository.countClaimsSince(template.referrerId, since);
    const cap = await loadInt('referral.daily_claim_cap', DEFAULT_DAILY_CLAIM_CAP);
    if (recent >= cap) {
      return err('RATE_LIMIT', 'this code has reached its limit for today');
    }

    // Same-device check (F3/F7): if the referred user's device has ever been used by the
    // referrer, treat it as a self-referral farm — record the claim as rejected_fraud +
    // a fraud signal, and do NOT create a rewardable pending claim.
    const sameDevice = await this.sharesDeviceWith(
      args.referredUserId,
      template.referrerId,
      args.deviceFingerprint ?? null,
    );

    // `code` is globally unique per row, so the claim row gets its own (the shared
    // `code` stays on the template). We keep the source code on the event payload.
    const claimCode = await allocateUniqueCode();
    if (!claimCode) return err('INTERNAL', 'could not record the referral');

    await prisma.$transaction(async (tx) => {
      await referralRepository.create(tx, {
        referrerId: template.referrerId,
        referredId: args.referredUserId,
        code: claimCode,
        status: sameDevice ? 'rejected_fraud' : 'pending',
        qualifiedByEvent: null,
      });
      if (sameDevice) {
        await safetyRepository.createFraudSignal(tx, {
          userId: template.referrerId,
          signal: 'referral_self_same_device',
          weight: SELF_REFERRAL_SAME_DEVICE_WEIGHT,
          refType: 'referral',
          refId: null,
        });
      }
      await emitEvent(tx, {
        eventType: sameDevice ? 'referral.rejected_fraud' : 'referral.claimed',
        actorId: args.referredUserId,
        refType: 'user',
        refId: template.referrerId,
        payload: { code, same_device: sameDevice },
      });
    });

    // We return success either way so we don't tell a farmer which rule they tripped;
    // a rejected_fraud claim simply never qualifies.
    return ok({ status: 'pending' });
  },

  /**
   * Called after a worker's assignment reaches `completed`. If this was their FIRST
   * completed job and they have a pending referral, qualify it and pay the referrer.
   * Idempotent: a second call (or a second completed job) finds no pending claim / not
   * the first completion and does nothing. Best-effort — never throws into the caller.
   */
  async qualifyOnFirstCompletion(referredUserId: string): Promise<void> {
    const pending = await referralRepository.findPendingClaimForReferred(referredUserId);
    if (!pending) return; // no referral, or already qualified/rejected

    // "First completed job" — qualify only on exactly the first completion so a referral
    // can't be re-triggered by later jobs (and to make the trigger unambiguous).
    const completed = await referralRepository.countCompletedAssignments(referredUserId);
    if (completed !== 1) return;

    const rewardMinor = await loadInt('referral.reward_minor', DEFAULT_REWARD_MINOR);

    try {
      await prisma.$transaction(async (tx) => {
        // Re-read inside the txn and lock the status flip via the pending precondition:
        // updateMany on (id, status='pending') is the idempotency guard — a concurrent
        // qualify wins once, the loser updates 0 rows and skips the payout.
        const flip = await tx.referral.updateMany({
          where: { id: pending.id, status: 'pending' },
          data: { status: 'qualified', qualifiedByEvent: 'assignment.completed', rewardMinor },
        });
        if (flip.count === 0) return; // someone else qualified it first

        const platform = await ensureWallet(tx, { userId: null, kind: 'platform_revenue' });
        const referrer = await ensureWallet(tx, { userId: pending.referrerId, kind: 'user' });
        await writeLedgerTxn(tx, {
          legs: [
            {
              walletId: platform.id,
              amountMinor: BigInt(-rewardMinor),
              reason: 'referral_bonus',
              refType: 'referral',
              refId: pending.id,
            },
            {
              walletId: referrer.id,
              amountMinor: BigInt(rewardMinor),
              reason: 'referral_bonus',
              refType: 'referral',
              refId: pending.id,
            },
          ],
        });
        await emitEvent(tx, {
          eventType: 'referral.qualified',
          actorId: null,
          refType: 'referral',
          refId: pending.id,
          payload: { referrer_id: pending.referrerId, reward_minor: rewardMinor },
        });
      });
    } catch (e) {
      // Never fail the completion path on referral payout — it can be reconciled.
      // eslint-disable-next-line no-console
      console.error('[referral] qualify failed:', e instanceof Error ? e.message : String(e));
    }
  },

  /** True if `a` and `b` share any device fingerprint (incl. the one `a` is using now). */
  async sharesDeviceWith(
    a: string,
    b: string,
    aCurrentFingerprint: string | null,
  ): Promise<boolean> {
    const bPrints = new Set(await referralRepository.fingerprintsForUser(b));
    if (bPrints.size === 0 && !aCurrentFingerprint) return false;
    if (aCurrentFingerprint && bPrints.has(aCurrentFingerprint)) return true;
    const aPrints = await referralRepository.fingerprintsForUser(a);
    return aPrints.some((p) => bPrints.has(p));
  },
};

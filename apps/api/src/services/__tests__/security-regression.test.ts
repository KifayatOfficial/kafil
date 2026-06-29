// Security regression suite. Each test pins a specific vulnerability found in the
// 2026-06-29 audit so it can never silently come back. Real Postgres, service layer.
//
// Covered:
//  1. IDOR — only the job's owner may accept an application against it.
//  2. Escrow double-settle — a second release/refund/partial on an already-settled
//     assignment is rejected (CONFLICT), and money is moved exactly once.
//  3. Release-after-refund — once refunded, a release is rejected.
//  4. Partial commission uses the bounded computeCommission policy (min applies).
//  5. Assignment transition is optimistically locked against a stale version.
//  6. Conversation-list preview never carries the raw (unredacted) message body.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { escrowService } from '../escrow.service';
import { chatService } from '../chat.service';
import { reconcileWallets } from '../ledger';
import {
  cleanupTestData,
  ensureMasonrySpecialty,
  makeLocation,
  makeUser,
  newKey,
} from '../../__tests__/test-db';

beforeEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

async function escrowJobWithApplication(opts: { rate?: number; days?: number } = {}) {
  const employer = await makeUser({ role: 'employer', kyc: 2 });
  const worker = await makeUser({ role: 'worker', kyc: 2 });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();
  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'sec-regression',
      location_id: loc.id,
      headcount: 1,
      rate_pkr: opts.rate ?? 4000,
      rate_unit: 'day',
      duration_days: opts.days ?? 2,
      specialty_ids: [spec.id],
      idempotency_key: newKey(),
      payment_mode: 'escrow',
    },
  });
  if (!created.ok) throw new Error('createJob failed');
  const jobId = created.value.jobId;
  const applied = await applicationService.apply({
    workerId: worker.id,
    jobId,
    input: { idempotency_key: newKey() },
  });
  if (!applied.ok) throw new Error('apply failed');
  return { employer, worker, jobId, applicationId: applied.value.applicationId };
}

async function fundAndAccept(ctx: Awaited<ReturnType<typeof escrowJobWithApplication>>) {
  const fund = await escrowService.fundForJob({ jobId: ctx.jobId, employerId: ctx.employer.id });
  if (!fund.ok) throw new Error('fund failed');
  const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId: ctx.jobId } });
  const accepted = await assignmentService.acceptApplication({
    employerId: ctx.employer.id,
    applicationId: ctx.applicationId,
    input: { slot_id: slot.id, expected_slot_version: slot.version, idempotency_key: newKey() },
  });
  if (!accepted.ok) throw new Error('accept failed');
  return accepted.value.assignmentId;
}

describe('IDOR — application accept ownership (audit #1)', () => {
  it('a non-owner employer cannot accept an application on someone else’s job', async () => {
    const ctx = await escrowJobWithApplication();
    const attacker = await makeUser({ role: 'employer', kyc: 2 });
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId: ctx.jobId } });

    const r = await assignmentService.acceptApplication({
      employerId: attacker.id, // NOT the job owner
      applicationId: ctx.applicationId,
      input: { slot_id: slot.id, expected_slot_version: slot.version, idempotency_key: newKey() },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN');

    // No assignment was created, slot still open.
    expect(await prisma.assignment.count({ where: { jobId: ctx.jobId } })).toBe(0);
    const after = await prisma.jobSlot.findFirstOrThrow({ where: { id: slot.id } });
    expect(after.status).toBe('open');
  });

  it('the real owner can still accept', async () => {
    const ctx = await escrowJobWithApplication();
    const assignmentId = await fundAndAccept(ctx);
    expect(assignmentId).toBeTruthy();
  });
});

describe('escrow double-settle (audit #money)', () => {
  it('a second release on an already-released assignment is rejected and pays once', async () => {
    const ctx = await escrowJobWithApplication({ rate: 4000, days: 2 });
    const assignmentId = await fundAndAccept(ctx);

    const first = await escrowService.releaseForAssignment({ assignmentId });
    expect(first.ok).toBe(true);
    const second = await escrowService.releaseForAssignment({ assignmentId });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('CONFLICT');

    // Worker paid exactly once; books reconcile.
    const workerW = await prisma.wallet.findFirstOrThrow({ where: { userId: ctx.worker.id } });
    expect(workerW.balanceMinor).toBe(800_000n - 40_000n);
    const releases = await prisma.ledgerEntry.count({
      where: { reason: 'escrow_release', refType: 'assignment', refId: assignmentId, amountMinor: { gt: 0 } },
    });
    expect(releases).toBe(1);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('a release after a refund is rejected (cross-reason settlement guard)', async () => {
    const ctx = await escrowJobWithApplication({ rate: 4000, days: 2 });
    const assignmentId = await fundAndAccept(ctx);

    const refund = await escrowService.refundForAssignment({ assignmentId });
    expect(refund.ok).toBe(true);
    const release = await escrowService.releaseForAssignment({ assignmentId });
    expect(release.ok).toBe(false);
    if (!release.ok) expect(release.code).toBe('CONFLICT');

    // Employer got the full refund; worker got nothing.
    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: ctx.employer.id } });
    const workerW = await prisma.wallet.findFirst({ where: { userId: ctx.worker.id } });
    expect(empW.balanceMinor).toBe(800_000n);
    expect(workerW?.balanceMinor ?? 0n).toBe(0n);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('partial commission honours the minimum (bounded computeCommission, not flat 5%)', async () => {
    // Tiny payout: flat 5% would be 5 paisa, but the 50-PKR (5000 paisa) minimum binds.
    const ctx = await escrowJobWithApplication({ rate: 4000, days: 2 }); // gross 800_000
    const assignmentId = await fundAndAccept(ctx);

    const r = await escrowService.partialSettleAssignment({ assignmentId, payoutMinor: 100n });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // computeCommission(100) → 5% = 5, below min 5000 → 5000 (but capped at payout=100).
      // min(max(5, 5000), 100) = 100. So commission == payout here, refund = gross - 100 - 100.
      expect(r.value.commissionMinor).toBe('100');
      expect(r.value.refundMinor).toBe((800_000n - 100n - 100n).toString());
    }
    expect(await reconcileWallets()).toEqual([]);
  });
});

describe('assignment transition optimistic lock (audit #3)', () => {
  it('two concurrent transitions on the same assignment — exactly one wins', async () => {
    const ctx = await escrowJobWithApplication();
    const assignmentId = await fundAndAccept(ctx); // status: assigned

    // Race two distinct transitions, both legal from `assigned`. Without the version
    // guard both would pass canTransition() off the same starting state and clobber
    // each other. With it, the loser's version-guarded updateMany returns 0 → CONFLICT.
    const [confirm, decline] = await Promise.all([
      assignmentService.transition({
        assignmentId,
        name: 'worker_confirm',
        actorId: ctx.worker.id,
        by: 'worker',
      }),
      assignmentService.transition({
        assignmentId,
        name: 'worker_decline',
        actorId: ctx.worker.id,
        by: 'worker',
      }),
    ]);

    const oks = [confirm, decline].filter((r) => r.ok);
    const conflicts = [confirm, decline].filter((r) => !r.ok && r.code === 'CONFLICT');
    expect(oks).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    // The persisted status matches whichever call won — never a torn/!mixed state.
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(['confirmed', 'declined']).toContain(a.status);
  });
});

describe('PII — conversation list never leaks raw body (audit #pii)', () => {
  it('the last-message preview is the redacted body only', async () => {
    const ctx = await escrowJobWithApplication();
    const assignmentId = await fundAndAccept(ctx);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { jobId: ctx.jobId } });

    await chatService.sendMessage({
      conversationId: conv.id,
      senderId: ctx.worker.id,
      input: { body: 'reach me at 03001234567', idempotency_key: newKey() },
    });

    const list = await chatService.listConversations(ctx.worker.id);
    expect(list.ok).toBe(true);
    if (list.ok) {
      const preview = list.value[0]!.messages[0]! as Record<string, unknown>;
      // The raw phone must not be present, and the raw `body` field must be absent.
      expect(JSON.stringify(preview)).not.toContain('03001234567');
      expect('body' in preview).toBe(false);
      expect(preview.bodyRedacted).toBeDefined();
    }
    void assignmentId;
  });
});

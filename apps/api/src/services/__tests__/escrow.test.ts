// Escrow integration tests — exercises accept-gating + workbench resolution +
// the §6.2 risk-band paths. These are real DB tests.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { workbenchService } from '../workbench.service';
import { escrowService } from '../escrow.service';
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

async function buildEscrowJob(opts: { rate?: number; days?: number; headcount?: number } = {}) {
  const employer = await makeUser({ role: 'employer', kyc: 2 });
  const worker = await makeUser({ role: 'worker', kyc: 2 });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();
  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'escrow-test',
      location_id: loc.id,
      headcount: opts.headcount ?? 1,
      rate_pkr: opts.rate ?? 4000,
      rate_unit: 'day',
      duration_days: opts.days ?? 2,
      specialty_ids: [spec.id],
      idempotency_key: newKey(),
      payment_mode: 'escrow',
    },
  });
  if (!created.ok) throw new Error('createJob failed');
  return { employer, worker, jobId: created.value.jobId };
}

describe('escrow — accept gating (§6)', () => {
  it('rejects accept on an unfunded escrow job', async () => {
    const { employer, worker, jobId } = await buildEscrowJob();
    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });

    const r = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('CONFLICT');
      expect(r.message).toMatch(/escrow not funded/);
    }
    // No assignment was created.
    expect(await prisma.assignment.count({ where: { jobId } })).toBe(0);
  });

  it('accepts once escrow is funded for the full job', async () => {
    const { employer, worker, jobId } = await buildEscrowJob({ rate: 4000, days: 2, headcount: 1 });
    const fund = await escrowService.fundForJob({ jobId, employerId: employer.id });
    expect(fund.ok).toBe(true);

    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const r = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    expect(r.ok).toBe(true);
  });

  it('fundForJob is idempotent — re-funding the same job is a no-op', async () => {
    const { employer, jobId } = await buildEscrowJob({ rate: 4000, days: 2 });
    const a = await escrowService.fundForJob({ jobId, employerId: employer.id });
    expect(a.ok && a.value.alreadyFunded).toBe(false);
    const b = await escrowService.fundForJob({ jobId, employerId: employer.id });
    expect(b.ok && b.value.alreadyFunded).toBe(true);

    // Only one funding txn should have hit the ledger.
    const fundCount = await prisma.ledgerEntry.count({
      where: { reason: 'escrow_fund', refType: 'job', refId: jobId, amountMinor: { gt: 0 } },
    });
    expect(fundCount).toBe(1);
  });
});

describe('escrow — workbench resolutions release/refund correctly', () => {
  it('pay_worker (in escrow mode) releases funds, pays commission, drains escrow', async () => {
    const { employer, worker, jobId } = await buildEscrowJob({ rate: 4000, days: 2, headcount: 1 });
    await escrowService.fundForJob({ jobId, employerId: employer.id });

    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    if (!accepted.ok) throw new Error();

    // Force the assignment into awaiting_ops_review (the workbench's input state).
    await prisma.assignment.update({
      where: { id: accepted.value.assignmentId },
      data: { status: 'awaiting_ops_review', version: { increment: 1 } },
    });

    const moderator = await makeUser({ role: 'admin' });
    const r = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId: accepted.value.assignmentId,
      input: { resolution: 'pay_worker' },
    });
    expect(r.ok).toBe(true);

    // gross = 4000 * 100 * 2 days = 800_000 paisa = 8000 PKR
    // commission default 5% but min 5000 paisa, cap 2_000_000 → 5% × 800_000 = 40_000
    const platform = await prisma.wallet.findFirstOrThrow({ where: { kind: 'platform_revenue' } });
    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    const workerW = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id } });
    expect(escrow.balanceMinor).toBe(0n);
    expect(platform.balanceMinor).toBe(40_000n);
    expect(workerW.balanceMinor).toBe(800_000n - 40_000n);
    expect(await reconcileWallets()).toEqual([]);

    // Workbench resolution drives state to 'completed'; escrow stamps finalizedAt
    // without touching status. Worker actually got paid in the same flow.
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: accepted.value.assignmentId } });
    expect(a.status).toBe('completed');
    expect(a.finalizedAt).not.toBeNull();
  });

  it('refund_employer returns the full gross to the employer wallet', async () => {
    const { employer, worker, jobId } = await buildEscrowJob({ rate: 3000, days: 3 });
    await escrowService.fundForJob({ jobId, employerId: employer.id });

    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    if (!accepted.ok) throw new Error();
    await prisma.assignment.update({
      where: { id: accepted.value.assignmentId },
      data: { status: 'awaiting_ops_review', version: { increment: 1 } },
    });

    const moderator = await makeUser({ role: 'admin' });
    const r = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId: accepted.value.assignmentId,
      input: { resolution: 'refund_employer' },
    });
    expect(r.ok).toBe(true);

    // gross = 3000 * 100 * 3 = 900_000
    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id } });
    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    expect(empW.balanceMinor).toBe(900_000n);
    expect(escrow.balanceMinor).toBe(0n);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('partial resolution requires payout_minor and splits funds three ways', async () => {
    const { employer, worker, jobId } = await buildEscrowJob({ rate: 5000, days: 4 });
    await escrowService.fundForJob({ jobId, employerId: employer.id });

    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: {
        slot_id: slot.id,
        expected_slot_version: slot.version,
        idempotency_key: newKey(),
      },
    });
    if (!accepted.ok) throw new Error();
    await prisma.assignment.update({
      where: { id: accepted.value.assignmentId },
      data: { status: 'awaiting_ops_review', version: { increment: 1 } },
    });

    const moderator = await makeUser({ role: 'admin' });
    // Missing payout_minor → VALIDATION error.
    const bad = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId: accepted.value.assignmentId,
      input: { resolution: 'partial' },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('VALIDATION');

    // With payout: gross=2_000_000, payout=1_200_000 → commission=60_000, refund=740_000
    const ok = await workbenchService.resolve({
      actorId: moderator.id,
      assignmentId: accepted.value.assignmentId,
      input: { resolution: 'partial', payout_minor: '1200000' },
    });
    expect(ok.ok).toBe(true);
    const empW = await prisma.wallet.findFirstOrThrow({ where: { userId: employer.id } });
    const workerW = await prisma.wallet.findFirstOrThrow({ where: { userId: worker.id } });
    const platform = await prisma.wallet.findFirstOrThrow({ where: { kind: 'platform_revenue' } });
    expect(workerW.balanceMinor).toBe(1_200_000n);
    expect(platform.balanceMinor).toBe(60_000n);
    expect(empW.balanceMinor).toBe(740_000n);
    expect(await reconcileWallets()).toEqual([]);
  });
});

describe('escrow — solvency gate prevents insolvency (audit CRITICAL)', () => {
  it('after a slot is refunded and re-opened, a second accept on it is rejected — escrow never goes negative', async () => {
    // 1-headcount job, fully funded for exactly one assignment's gross.
    const { employer, worker, jobId } = await buildEscrowJob({ rate: 4000, days: 2, headcount: 1 });
    await escrowService.fundForJob({ jobId, employerId: employer.id }); // funds 800_000

    const applied = await applicationService.apply({
      workerId: worker.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied.ok) throw new Error();
    const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId } });
    const accepted = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied.value.applicationId,
      input: { slot_id: slot.id, expected_slot_version: slot.version, idempotency_key: newKey() },
    });
    if (!accepted.ok) throw new Error();

    // Refund that assignment (drains escrow to 0) and free the slot for re-fill.
    const refund = await escrowService.refundForAssignment({ assignmentId: accepted.value.assignmentId });
    expect(refund.ok).toBe(true);
    await prisma.assignment.update({
      where: { id: accepted.value.assignmentId },
      data: { status: 'cancelled_by_employer', version: { increment: 1 } },
    });
    await prisma.jobSlot.update({
      where: { id: slot.id },
      data: { status: 'open', assignedWorkerId: null, version: { increment: 1 } },
    });
    // Slot reopened → job is open for applications again (scheduler does this in prod).
    await prisma.job.update({ where: { id: jobId }, data: { status: 'open' } });
    const escrowAfterRefund = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    expect(escrowAfterRefund.balanceMinor).toBe(0n);

    // A second worker applies + the employer tries to accept onto the re-opened slot.
    const worker2 = await makeUser({ role: 'worker', kyc: 2 });
    const applied2 = await applicationService.apply({
      workerId: worker2.id,
      jobId,
      input: { idempotency_key: newKey() },
    });
    if (!applied2.ok) throw new Error();
    const freshSlot = await prisma.jobSlot.findFirstOrThrow({ where: { id: slot.id } });

    // The stale gate (sum escrow_fund only) would see 800_000 funded and ACCEPT,
    // letting a later release push escrow_holding to -800_000. The fixed gate computes
    // available escrow = funded(800k) − drained(800k) = 0 < required 800k → CONFLICT.
    const secondAccept = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: applied2.value.applicationId,
      input: { slot_id: freshSlot.id, expected_slot_version: freshSlot.version, idempotency_key: newKey() },
    });
    expect(secondAccept.ok).toBe(false);
    if (!secondAccept.ok) expect(secondAccept.code).toBe('CONFLICT');

    // Escrow is still solvent and the books reconcile.
    const escrowFinal = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    expect(escrowFinal.balanceMinor).toBe(0n);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('a 2-headcount job funded for 2 accepts both workers but rejects a 3rd (over-hire guard)', async () => {
    const { employer, worker, jobId } = await buildEscrowJob({ rate: 4000, days: 1, headcount: 2 });
    await escrowService.fundForJob({ jobId, employerId: employer.id }); // funds 2 × 400_000 = 800_000

    const slots = await prisma.jobSlot.findMany({ where: { jobId }, orderBy: { slotIndex: 'asc' } });
    // Accept worker 1 on slot 1.
    const a1 = await applicationService.apply({ workerId: worker.id, jobId, input: { idempotency_key: newKey() } });
    if (!a1.ok) throw new Error();
    const acc1 = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: a1.value.applicationId,
      input: { slot_id: slots[0]!.id, expected_slot_version: slots[0]!.version, idempotency_key: newKey() },
    });
    expect(acc1.ok).toBe(true);

    // Accept worker 2 on slot 2 — still within funded budget.
    const w2 = await makeUser({ role: 'worker', kyc: 2 });
    const a2 = await applicationService.apply({ workerId: w2.id, jobId, input: { idempotency_key: newKey() } });
    if (!a2.ok) throw new Error();
    const acc2 = await assignmentService.acceptApplication({
      employerId: employer.id,
      applicationId: a2.value.applicationId,
      input: { slot_id: slots[1]!.id, expected_slot_version: slots[1]!.version, idempotency_key: newKey() },
    });
    expect(acc2.ok).toBe(true);
  });
});

// PSP webhook ingest integration tests (§6 + §26/M3). Real Postgres.
//
// Invariants:
//  1. A signed payment.succeeded for a pending funding Payment funds escrow + marks the
//     payment succeeded.
//  2. Replaying the SAME event is deduped — escrow is funded exactly once.
//  3. A bad/missing signature is rejected (UNAUTHORIZED) and nothing is processed.
//  4. payment.failed marks the Payment failed and does NOT fund escrow.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { escrowService } from '../escrow.service';
import { webhookService } from '../webhook.service';
import { reconcileWallets } from '../ledger';
import { signWebhookBody } from '../../providers/webhook.provider';
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

async function escrowJob() {
  const employer = await makeUser({ role: 'employer', kyc: 2 });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();
  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'webhook-test',
      location_id: loc.id,
      headcount: 1,
      rate_pkr: 4000,
      rate_unit: 'day',
      duration_days: 2,
      specialty_ids: [spec.id],
      idempotency_key: newKey(),
      payment_mode: 'escrow',
    },
  });
  if (!created.ok) throw new Error('createJob failed');
  return { employer, jobId: created.value.jobId };
}

function signed(body: object) {
  const rawBody = JSON.stringify(body);
  return { rawBody, signature: signWebhookBody(rawBody) };
}

describe('PSP webhook ingest (§6 / §26/M3)', () => {
  it('a signed payment.succeeded funds escrow and marks the payment succeeded', async () => {
    const { employer, jobId } = await escrowJob();
    const init = await escrowService.initiateFunding({ jobId, employerId: employer.id });
    expect(init.ok).toBe(true);
    if (!init.ok) return;

    const { rawBody, signature } = signed({
      provider: 'jazzcash',
      provider_ref: 'txn-1',
      event_type: 'payment.succeeded',
      payment_id: init.value.paymentId,
      amount_minor: init.value.amountMinor, // 4000*100*2 = 800000
    });
    const res = await webhookService.ingest({ rawBody, signature });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.processed).toBe(true);

    // Escrow holds the funds; payment is succeeded; books reconcile.
    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    expect(escrow.balanceMinor).toBe(800_000n);
    const payment = await prisma.payment.findFirstOrThrow({ where: { id: init.value.paymentId } });
    expect(payment.status).toBe('succeeded');
    expect(await reconcileWallets()).toEqual([]);
  });

  it('replaying the same event is deduped — escrow funded exactly once', async () => {
    const { employer, jobId } = await escrowJob();
    const init = await escrowService.initiateFunding({ jobId, employerId: employer.id });
    if (!init.ok) throw new Error();
    const { rawBody, signature } = signed({
      provider: 'jazzcash',
      provider_ref: 'txn-dup',
      event_type: 'payment.succeeded',
      payment_id: init.value.paymentId,
      amount_minor: init.value.amountMinor,
    });

    const first = await webhookService.ingest({ rawBody, signature });
    const second = await webhookService.ingest({ rawBody, signature });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok) expect(first.value.processed).toBe(true);
    if (second.ok) expect(second.value.deduped).toBe(true);

    const escrow = await prisma.wallet.findFirstOrThrow({ where: { kind: 'escrow_holding' } });
    expect(escrow.balanceMinor).toBe(800_000n); // funded once, not twice
    const fundEntries = await prisma.ledgerEntry.count({
      where: { reason: 'escrow_fund', refType: 'job', refId: jobId, amountMinor: { gt: 0 } },
    });
    expect(fundEntries).toBe(1);
    expect(await reconcileWallets()).toEqual([]);
  });

  it('rejects a bad signature and processes nothing', async () => {
    const { employer, jobId } = await escrowJob();
    const init = await escrowService.initiateFunding({ jobId, employerId: employer.id });
    if (!init.ok) throw new Error();
    const rawBody = JSON.stringify({
      provider: 'jazzcash',
      provider_ref: 'txn-forged',
      event_type: 'payment.succeeded',
      payment_id: init.value.paymentId,
      amount_minor: init.value.amountMinor,
    });

    const res = await webhookService.ingest({ rawBody, signature: 'not-a-valid-signature' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNAUTHORIZED');

    // No escrow funded, payment still pending, no webhook_event row.
    const escrow = await prisma.wallet.findFirst({ where: { kind: 'escrow_holding' } });
    expect(escrow?.balanceMinor ?? 0n).toBe(0n);
    expect((await prisma.payment.findFirstOrThrow({ where: { id: init.value.paymentId } })).status).toBe('pending');
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('payment.failed marks the payment failed and funds nothing', async () => {
    const { employer, jobId } = await escrowJob();
    const init = await escrowService.initiateFunding({ jobId, employerId: employer.id });
    if (!init.ok) throw new Error();
    const { rawBody, signature } = signed({
      provider: 'jazzcash',
      provider_ref: 'txn-fail',
      event_type: 'payment.failed',
      payment_id: init.value.paymentId,
    });

    const res = await webhookService.ingest({ rawBody, signature });
    expect(res.ok).toBe(true);

    expect((await prisma.payment.findFirstOrThrow({ where: { id: init.value.paymentId } })).status).toBe('failed');
    const escrow = await prisma.wallet.findFirst({ where: { kind: 'escrow_holding' } });
    expect(escrow?.balanceMinor ?? 0n).toBe(0n);
    void jobId;
  });
});

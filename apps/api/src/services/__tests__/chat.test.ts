// Integration tests for the chat service. Real Postgres; real auth/assignment flow.
//
// Invariants:
// 1. Conversation is auto-created on accept; both parties are participants (§5).
// 2. A non-participant cannot list or send messages (FORBIDDEN).
// 3. listMessages returns the redacted body — never the raw body — to readers.
// 4. Sending a message with PII produces a fraud_signal row (§10/F2).
// 5. Re-sending the same idempotency key returns the same message id (P4).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/db';
import { jobService } from '../job.service';
import { applicationService } from '../application.service';
import { assignmentService } from '../assignment.service';
import { chatService } from '../chat.service';
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

async function buildAcceptedAssignment() {
  const employer = await makeUser({ role: 'employer' });
  const worker = await makeUser({ role: 'worker' });
  const loc = await makeLocation();
  const spec = await ensureMasonrySpecialty();

  const created = await jobService.createJob({
    employerId: employer.id,
    input: {
      title: 'chat-test',
      location_id: loc.id,
      headcount: 1,
      rate_pkr: 3000,
      rate_unit: 'day',
      specialty_ids: [spec.id],
      idempotency_key: newKey(),
      payment_mode: 'cash',
    },
  });
  if (!created.ok) throw new Error('createJob failed');

  const applied = await applicationService.apply({
    workerId: worker.id,
    jobId: created.value.jobId,
    input: { idempotency_key: newKey() },
  });
  if (!applied.ok) throw new Error('apply failed');

  const slot = await prisma.jobSlot.findFirstOrThrow({ where: { jobId: created.value.jobId } });
  const accepted = await assignmentService.acceptApplication({
    employerId: employer.id,
    applicationId: applied.value.applicationId,
    input: {
      slot_id: slot.id,
      expected_slot_version: slot.version,
      idempotency_key: newKey(),
    },
  });
  if (!accepted.ok) throw new Error('accept failed');

  return {
    employer,
    worker,
    assignmentId: accepted.value.assignmentId,
    conversationId: accepted.value.conversationId,
  };
}

describe('chat — anti-disintermediation channel (§5)', () => {
  it('accepting creates a conversation with both parties as participants', async () => {
    const { employer, worker, conversationId } = await buildAcceptedAssignment();
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { participants: true },
    });
    expect(conv.participants.map((p) => p.userId).sort()).toEqual(
      [employer.id, worker.id].sort(),
    );
  });

  it('non-participant cannot list or send messages (FORBIDDEN)', async () => {
    const { conversationId } = await buildAcceptedAssignment();
    const stranger = await makeUser({ role: 'worker' });

    const list = await chatService.listMessages({ conversationId, userId: stranger.id });
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.code).toBe('FORBIDDEN');

    const send = await chatService.sendMessage({
      conversationId,
      senderId: stranger.id,
      input: { body: 'hi', idempotency_key: newKey() },
    });
    expect(send.ok).toBe(false);
    if (!send.ok) expect(send.code).toBe('FORBIDDEN');
  });

  it('listMessages returns redacted body only — raw body never leaves the server', async () => {
    const { worker, conversationId } = await buildAcceptedAssignment();
    const res = await chatService.sendMessage({
      conversationId,
      senderId: worker.id,
      input: { body: 'My number is 03001234567', idempotency_key: newKey() },
    });
    expect(res.ok).toBe(true);

    const list = await chatService.listMessages({
      conversationId,
      userId: worker.id,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const msg = list.value[0]!;
      expect(msg.body).not.toContain('03001234567');
      expect(msg.body).toContain('[hidden');
      expect(msg.flagged).toBe(true);
    }

    // Server still has the raw body for moderator forensic use.
    const raw = await prisma.message.findFirstOrThrow({ where: { conversationId } });
    expect(raw.body).toContain('03001234567');
    expect(raw.bodyRedacted).toContain('[hidden');
  });

  it('a flagged message produces a fraud_signal row weighted ≥50 (phone)', async () => {
    const { worker, conversationId } = await buildAcceptedAssignment();
    await chatService.sendMessage({
      conversationId,
      senderId: worker.id,
      input: { body: 'call 03001234567', idempotency_key: newKey() },
    });
    const sig = await prisma.fraudSignal.findFirstOrThrow({
      where: { userId: worker.id, signal: 'contact_in_message' },
    });
    expect(sig.weight).toBeGreaterThanOrEqual(50);
  });

  it('fee-pattern messages get the stronger placeholder + highest weight', async () => {
    const { employer, conversationId } = await buildAcceptedAssignment();
    await chatService.sendMessage({
      conversationId,
      senderId: employer.id,
      input: { body: 'first pay a 500 registration fee', idempotency_key: newKey() },
    });
    const list = await chatService.listMessages({ conversationId, userId: employer.id });
    if (!list.ok) throw new Error();
    expect(list.value[0]!.body).toContain('never asks workers to pay');

    const sig = await prisma.fraudSignal.findFirstOrThrow({
      where: { userId: employer.id, signal: 'contact_in_message' },
    });
    expect(sig.weight).toBe(80);
  });
});

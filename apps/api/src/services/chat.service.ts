// Chat service — the anti-disintermediation channel (§5).
//
// Reads:
//   - listConversations(userId) — only conversations the user participates in.
//   - listMessages(conversationId, userId) — gated by participation.
//   - When returning messages to a non-moderator: only body_redacted is exposed.
//
// Writes:
//   - sendMessage runs the PII redactor BEFORE persisting. The raw text is stored in
//     messages.body for moderator forensic use ONLY; readers see body_redacted.
//   - If the redactor flagged the message, we also create a fraud_signals row so the
//     ops dashboard can rank repeat offenders (§9/§10/F2).

import { SendMessageInput } from '@kafil/core';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { err, ok, type Result } from '../lib/result';
import { conversationRepository } from '../repositories/conversation.repository';
import { redact } from './pii-redactor';

async function assertParticipant(conversationId: string, userId: string) {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) return null;
  const inIt = conv.participants.some((p) => p.userId === userId);
  return inIt ? conv : false;
}

export const chatService = {
  async listConversations(
    userId: string,
  ): Promise<Result<Awaited<ReturnType<typeof conversationRepository.listForUser>>>> {
    return ok(await conversationRepository.listForUser(userId));
  },

  async listMessages(args: { conversationId: string; userId: string }) {
    const conv = await assertParticipant(args.conversationId, args.userId);
    if (conv === null) return err('NOT_FOUND', 'conversation not found');
    if (conv === false) return err('FORBIDDEN', 'not a participant');
    const messages = await conversationRepository.listMessages(args.conversationId);
    // Strip the raw body — only body_redacted leaves the server (§5/§24/B1).
    const safe = messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: m.bodyRedacted ?? m.body, // bodyRedacted is the source of truth for readers
      flagged: m.flagged,
      createdAt: m.createdAt,
    }));
    return ok(safe);
  },

  async sendMessage(args: {
    conversationId: string;
    senderId: string;
    input: unknown;
  }): Promise<Result<{ messageId: string; flagged: boolean; redactedDelta: number }>> {
    const parse = SendMessageInput.safeParse(args.input);
    if (!parse.success) return err('VALIDATION', 'invalid input', parse.error.flatten());

    const conv = await assertParticipant(args.conversationId, args.senderId);
    if (conv === null) return err('NOT_FOUND', 'conversation not found');
    if (conv === false) return err('FORBIDDEN', 'not a participant');

    const raw = parse.data.body;
    const { redacted, flagged, hits } = redact(raw);

    const result = await prisma.$transaction(async (tx) => {
      const msg = await conversationRepository.createMessage(tx, {
        conversationId: args.conversationId,
        senderId: args.senderId,
        body: raw, // moderator-only — never returned to readers
        bodyRedacted: redacted,
        flagged,
      });

      await emitEvent(tx, {
        eventType: 'chat.message_sent',
        actorId: args.senderId,
        refType: 'message',
        refId: msg.id,
        payload: { flagged, hit_kinds: hits.map((h) => h.kind) },
      });

      if (flagged) {
        // §10/F2 — record signal so a graph of repeat offenders is buildable.
        // Weight: highest for fee patterns, then phones, then social/url, then email.
        const weight = hits.some((h) => h.kind === 'fee_pattern')
          ? 80
          : hits.some((h) => h.kind === 'phone')
            ? 50
            : hits.some((h) => h.kind === 'social' || h.kind === 'url')
              ? 30
              : 10;
        await tx.fraudSignal.create({
          data: {
            userId: args.senderId,
            signal: 'contact_in_message',
            weight,
            refType: 'message',
            refId: msg.id,
          },
        });
      }

      return msg;
    });

    return ok({
      messageId: result.id,
      flagged,
      redactedDelta: raw.length - redacted.length,
    });
  },
};

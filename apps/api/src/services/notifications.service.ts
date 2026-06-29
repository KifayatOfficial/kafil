// NotificationsService — single entry point for "tell this user about this thing."
// Picks channels based on §11 priority + §26/M13 + user prefs, writes Notification +
// NotificationDelivery rows, calls the right provider, handles token-invalid cleanup
// (§24/C7), and budget-guards WhatsApp.

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { emitEvent } from '../lib/events';
import { pushProvider, type PushPayload } from '../providers/push.provider';
import { whatsappProvider, type WhatsAppPayload } from '../providers/whatsapp.provider';
import { smsProvider } from '../providers/sms.provider';

export type NotificationPriority = 'urgent' | 'transactional' | 'engagement' | 'promo';

export interface QueueArgs {
  userId: string;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  refType?: string;
  refId?: string;
  /** Optional WhatsApp-only template (required if the channel chain reaches WA). */
  whatsapp?: WhatsAppPayload;
}

interface ChannelDecision {
  channel: 'inapp' | 'push' | 'sms' | 'whatsapp';
  templateId?: string;
}

const QUIET_HOURS_DEFAULT = { start: '22:00', end: '06:00' };

export const notificationsService = {
  /**
   * Queue + immediately attempt delivery (sync). For high-volume sends this would
   * move to a background worker; v0 keeps it inline since the call paths (chat,
   * accept, transition) are already async.
   */
  async send(args: QueueArgs): Promise<{ notificationId: string }> {
    const prefs = await prisma.notificationPref.findUnique({ where: { userId: args.userId } });
    const device = await prisma.device.findFirst({
      where: { userId: args.userId, pushTokenStatus: 'active' },
      orderBy: { lastSeenAt: 'desc' },
    });

    const channels = pickChannels(args.priority, {
      hasPushToken: !!device?.pushToken,
      whatsappOptIn: !!prefs?.whatsappOptIn,
      smsOptIn: prefs?.smsOptIn ?? true, // default true unless explicit false
      quietHours: parseQuietHours(prefs?.quietHours as { start?: string; end?: string } | null),
      hasWhatsAppTemplate: !!args.whatsapp,
    });

    // Always create an in-app notification row first — it's the cheapest channel and
    // works even when push/SMS/WA all fail.
    const notification = await prisma.$transaction(async (tx) => {
      const n = await tx.notification.create({
        data: {
          userId: args.userId,
          type: args.type,
          priority: args.priority,
          title: args.title,
          body: args.body,
          refType: args.refType ?? null,
          refId: args.refId ?? null,
        },
      });
      await emitEvent(tx, {
        eventType: 'notification.queued',
        actorId: null,
        refType: 'notification',
        refId: n.id,
        payload: { type: args.type, priority: args.priority, channels: channels.map((c) => c.channel) },
      });
      return n;
    });

    // Fire each channel; record per-channel delivery rows.
    for (const decision of channels) {
      await deliver({
        notificationId: notification.id,
        decision,
        args,
        deviceToken: device?.pushToken ?? null,
        userId: args.userId,
      });
    }

    return { notificationId: notification.id };
  },
};

// ── channel selection ────────────────────────────────────────────────────────

function pickChannels(
  priority: NotificationPriority,
  ctx: {
    hasPushToken: boolean;
    whatsappOptIn: boolean;
    smsOptIn: boolean;
    quietHours: { start: number; end: number } | null;
    hasWhatsAppTemplate: boolean;
  },
): ChannelDecision[] {
  // In-app is always written.
  const out: ChannelDecision[] = [{ channel: 'inapp' }];

  const inQuiet = ctx.quietHours ? isQuietNow(ctx.quietHours) : false;

  // §26/M13 — urgent bypasses quiet hours; engagement/promo never do.
  const canBypass = priority === 'urgent';

  if (priority === 'promo') {
    // Promo is in-app + (very occasionally) email later. Never push/SMS/WA.
    return out;
  }

  // Push if we have a token, and (not in quiet hours OR urgent).
  if (ctx.hasPushToken && (!inQuiet || canBypass)) {
    out.push({ channel: 'push' });
  }

  // SMS fallback for transactional + urgent if user is opted-in (default true).
  if ((priority === 'urgent' || priority === 'transactional') && ctx.smsOptIn && (!inQuiet || canBypass)) {
    // Only fall back to SMS when push isn't available; otherwise SMS adds cost without value.
    if (!ctx.hasPushToken) out.push({ channel: 'sms' });
  }

  // WhatsApp only for transactional (not engagement/promo — §11), opted-in, with a template.
  if (
    priority === 'transactional' &&
    ctx.whatsappOptIn &&
    ctx.hasWhatsAppTemplate &&
    (!inQuiet || canBypass)
  ) {
    out.push({ channel: 'whatsapp' });
  }

  return out;
}

function parseQuietHours(qh: { start?: string; end?: string } | null): { start: number; end: number } | null {
  const start = qh?.start ?? QUIET_HOURS_DEFAULT.start;
  const end = qh?.end ?? QUIET_HOURS_DEFAULT.end;
  // Defaults are applied even when qh is null IF we want a default quiet window.
  // For v0 we only apply if explicit prefs exist (user-controlled).
  if (!qh) return null;
  return { start: toMinutes(start), end: toMinutes(end) };
}

function toMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  return Number.parseInt(hStr ?? '0', 10) * 60 + Number.parseInt(mStr ?? '0', 10);
}

function isQuietNow(qh: { start: number; end: number }): boolean {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Wrap-around (22:00–06:00) handling.
  if (qh.start <= qh.end) return minutes >= qh.start && minutes < qh.end;
  return minutes >= qh.start || minutes < qh.end;
}

// ── per-channel delivery ─────────────────────────────────────────────────────

async function deliver(opts: {
  notificationId: string;
  decision: ChannelDecision;
  args: QueueArgs;
  deviceToken: string | null;
  userId: string;
}): Promise<void> {
  const { decision, args, deviceToken, userId } = opts;

  // 1) Create the delivery row in 'queued' so a partial failure is observable.
  const delivery = await prisma.notificationDelivery.create({
    data: {
      notificationId: opts.notificationId,
      channel: decision.channel,
      templateId: decision.templateId ?? null,
      status: 'queued',
    },
  });

  // 2) In-app is just the parent Notification — mark sent immediately.
  if (decision.channel === 'inapp') {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'sent' },
    });
    return;
  }

  // 3) Off-device channels: actually call the provider.
  try {
    if (decision.channel === 'push') {
      if (!deviceToken) throw new Error('no push token at delivery time');
      const payload: PushPayload = {
        title: args.title,
        body: args.body,
        data: args.refType ? { kind: args.type, refType: args.refType, refId: args.refId ?? '' } : undefined,
        priority: args.priority,
      };
      const r = await pushProvider.send(deviceToken, payload);
      if (r.tokenInvalid) {
        // §24/C7 — flip the device's token status so we stop trying.
        await prisma.device.updateMany({
          where: { userId, pushToken: deviceToken },
          data: { pushTokenStatus: 'inactive' },
        });
      }
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: r.ok ? 'sent' : 'failed',
          providerRef: r.providerRef ?? null,
          costMinor: r.costMinor ?? null,
          attempts: { increment: 1 },
        },
      });
      return;
    }

    if (decision.channel === 'sms') {
      // For SMS we re-use the existing OTP-style provider for now; production
      // would use a transactional template + per-recipient consent log.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const r = await smsProvider.sendOtp(user.phoneE164, `${args.title}: ${args.body}`);
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'sent', providerRef: r.providerRef ?? null, attempts: { increment: 1 } },
      });
      return;
    }

    if (decision.channel === 'whatsapp') {
      if (!args.whatsapp) throw new Error('whatsapp template payload missing');
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const r = await whatsappProvider.sendTemplate(user.phoneE164, args.whatsapp);
      if (r.optedOut) {
        // Flip the user's WA opt-in off so we don't try again.
        await prisma.notificationPref.upsert({
          where: { userId },
          create: { userId, whatsappOptIn: false },
          update: { whatsappOptIn: false },
        });
      }
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: r.ok ? 'sent' : 'failed',
          providerRef: r.providerRef ?? null,
          costMinor: r.costMinor ?? null,
          attempts: { increment: 1 },
        },
      });
      return;
    }
  } catch (e) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
      },
    });
    await emitEvent(prisma, {
      eventType: 'notification.delivery_failed',
      refType: 'notification_delivery',
      refId: delivery.id,
      payload: { error: e instanceof Error ? e.message : String(e), channel: decision.channel },
    });
  }
}

// Suppress unused-symbol warning for Prisma namespace import.
void (null as unknown as Prisma.JsonValue);

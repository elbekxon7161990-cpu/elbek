import { Injectable } from '@nestjs/common';
import type { NewNotificationData, NotificationRecord, NotificationRepository } from '@afa/domain';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { toDomainNotificationRecord, toNotificationPayloadJson } from './notification.mapper';

/**
 * TASK-BOT-009 — implements @afa/domain's `NotificationRepository` port
 * against `notifications` (§13.9). `Notification` is RLS-protected
 * (`rls-protected-models.ts`); every method here uses `this.prisma` (the
 * RLS-extended client) directly, since no method combines a `Notification`
 * write with a second table's write in the same transaction (unlike
 * `PrismaTransactionRepository.create()`) — callers (e.g.
 * `NotificationDeliveryConsumer`) are responsible for running inside
 * `runWithUserContext(userId, ...)`, exactly as `PrismaCounterpartyRepository`'s
 * own callers already are.
 */
@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewNotificationData): Promise<NotificationRecord> {
    const row = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        payload: toNotificationPayloadJson(
          data.message,
          data.dedupKey,
          data.readyToDeliverAt,
          data.suppressedReason,
          data.replyMarkup,
        ) as unknown as Prisma.InputJsonValue,
        status: data.status ?? 'queued',
      },
    });
    return toDomainNotificationRecord(row);
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    return row ? toDomainNotificationRecord(row) : null;
  }

  /**
   * Idempotent: an already-`'sent'` row is left untouched (never re-stamps
   * `sentAt`) — the conditional `updateMany` only actually transitions a
   * row that isn't already `'sent'`, then this method re-reads and returns
   * the current state either way, so a redelivered BullMQ job sees a
   * consistent, already-`'sent'` result rather than an error.
   */
  async markSent(id: string, now: Date): Promise<NotificationRecord | null> {
    await this.prisma.notification.updateMany({
      where: { id, status: { not: 'sent' } },
      data: { status: 'sent', sentAt: now },
    });
    return this.findById(id);
  }

  async markFailed(id: string): Promise<NotificationRecord | null> {
    const result = await this.prisma.notification.updateMany({
      where: { id },
      data: { status: 'failed' },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(id);
  }
}

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { NotificationDeliveryQueue } from '@afa/domain';
import type { Queue } from 'bullmq';

import { NOTIFICATION_DELIVERY_QUEUE_NAME } from './notification-delivery.queue.module';

/** The BullMQ job payload — deliberately just two ids, never the message text (Chapter 16 §16.3 data minimization); `apps/worker`'s `NotificationDeliveryProcessor` always re-reads the real content from Postgres. */
export interface NotificationDeliveryJobPayload {
  notificationId: string;
  userId: string;
}

/**
 * TASK-BOT-009's `NotificationDeliveryQueue` implementation — a BullMQ
 * producer against the queue `NotificationDeliveryQueueModule` registers.
 * `jobId: notificationId` gives idempotent re-enqueueing for free (mirrors
 * `BullMqVoiceTranscriptionQueue`'s own established convention) — a
 * redelivered domain event that reaches `NotificationDeliveryConsumer`
 * again is expected to be caught earlier, by the dedup gate, before ever
 * reaching this call again for the same logical notification; `jobId`
 * uniqueness is a second, structural safety net, not the primary
 * mechanism.
 */
@Injectable()
export class BullMqNotificationDeliveryQueue implements NotificationDeliveryQueue {
  constructor(
    @InjectQueue(NOTIFICATION_DELIVERY_QUEUE_NAME)
    private readonly queue: Queue<NotificationDeliveryJobPayload>,
  ) {}

  async enqueue(notificationId: string, userId: string, deliverAt: Date): Promise<void> {
    const delay = Math.max(0, deliverAt.getTime() - Date.now());
    await this.queue.add(
      NOTIFICATION_DELIVERY_QUEUE_NAME,
      { notificationId, userId },
      { jobId: notificationId, delay },
    );
  }
}

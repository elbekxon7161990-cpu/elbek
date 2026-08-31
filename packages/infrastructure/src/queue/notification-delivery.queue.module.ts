import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * TASK-BOT-009 (§10.6.2's "Bot -> User" step; Chapter 3 §3.3.3 Job Queue &
 * Worker Pool) — the real, per-item Telegram-send job queue. This is
 * genuinely a Worker Pool job (an external network call, per-item, with
 * BR-SYS-004's own "bounded retries, then dead-letter" semantics) rather
 * than a DB-polling mechanism like FR-DB-015's own dispatcher — unlike
 * `domain_events`/`notifications`' RLS status, a per-job BullMQ payload
 * carries only `{ notificationId, userId }` (no message text, no PII
 * beyond an id — Chapter 16 §16.3 data minimization), with the real
 * content always re-read from Postgres (with correct RLS context) inside
 * the processor, never trusted from job data alone.
 *
 * `attempts`/`backoff` mirrors `SttTranscriptionQueueModule`'s own already-
 * justified judgment call exactly (3 attempts, exponential backoff from
 * 2s) — reused, not reinvented, per this task's own "don't invent retry
 * numbers" constraint. `removeOnFail: false` keeps an exhausted-retry job
 * visible for BR-SYS-004's dead-letter/observability requirement.
 */
export const NOTIFICATION_DELIVERY_QUEUE_NAME = 'notification-delivery';

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATION_DELIVERY_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  exports: [BullModule],
})
export class NotificationDeliveryQueueModule {}

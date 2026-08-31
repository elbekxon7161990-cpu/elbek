import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

export const ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME = 'account-purge-notification';

/**
 * The final-confirmation delivery queue (`apps/worker` produces,
 * `apps/telegram-bot` consumes). `attempts`/`backoff`/`removeOnFail` reuses
 * `NotificationDeliveryQueueModule`'s own already-justified judgment call
 * exactly (3 attempts, exponential backoff from 2s, failed jobs kept
 * visible) rather than inventing new retry numbers for what is, at the
 * BullMQ level, the same kind of job: one real, network-bound Telegram
 * send.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME,
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
export class AccountPurgeNotificationQueueModule {}

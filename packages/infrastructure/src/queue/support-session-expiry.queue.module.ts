import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

export const SUPPORT_SESSION_EXPIRY_QUEUE_NAME = 'support-session-expiry';

/** TASK-SEC-006 — the scheduled-scan queue, mirrors `AccountPurgeQueueModule` exactly. */
@Module({
  imports: [
    BullModule.registerQueue({
      name: SUPPORT_SESSION_EXPIRY_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  exports: [BullModule],
})
export class SupportSessionExpiryQueueModule {}

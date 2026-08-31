import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * Debt Reminder Producer task — mirrors `DomainEventDispatchQueueModule`'s
 * own exact reasoning (FR-DB-015): this queue carries no payload, it is
 * purely a periodic *trigger* ("run one debt-reminder eligibility scan"),
 * consumed by `apps/worker`'s own `DebtReminderScanProcessor`/
 * `DebtReminderScanScheduler`. `attempts: 1` for the identical reason —
 * the next scheduled firing already provides retry for a failed cycle; a
 * BullMQ-level retry on top would be redundant, uncontrolled extra load.
 */
export const DEBT_REMINDER_SCAN_QUEUE_NAME = 'debt-reminder-scan';

@Module({
  imports: [
    BullModule.registerQueue({
      name: DEBT_REMINDER_SCAN_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  exports: [BullModule],
})
export class DebtReminderScanQueueModule {}

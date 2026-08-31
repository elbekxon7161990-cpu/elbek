import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * TASK-FIN-003 (FR-BUD-003, NFR-BUD-002) — mirrors `DebtReminderScanQueueModule`'s
 * own exact reasoning: this queue carries no payload, it is purely a
 * periodic *trigger* ("run one budget-rollover cycle"), consumed by
 * `apps/worker`'s own `BudgetRolloverProcessor`/`BudgetRolloverScheduler`.
 * `attempts: 1` for the identical reason — the next scheduled firing
 * already provides retry for a failed cycle.
 */
export const BUDGET_ROLLOVER_QUEUE_NAME = 'budget-rollover';

@Module({
  imports: [
    BullModule.registerQueue({
      name: BUDGET_ROLLOVER_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  exports: [BullModule],
})
export class BudgetRolloverQueueModule {}

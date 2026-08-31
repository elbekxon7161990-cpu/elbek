import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

export const ACCOUNT_PURGE_QUEUE_NAME = 'account-purge';

/** The scheduled-scan queue — mirrors `BudgetRolloverQueueModule` exactly. */
@Module({
  imports: [
    BullModule.registerQueue({
      name: ACCOUNT_PURGE_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  exports: [BullModule],
})
export class AccountPurgeQueueModule {}

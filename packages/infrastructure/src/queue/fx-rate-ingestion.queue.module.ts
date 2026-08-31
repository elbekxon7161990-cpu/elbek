import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * TASK-FIN-007 Stage F (FR-INT-003) — mirrors `BudgetRolloverQueueModule`'s
 * own exact reasoning: this queue carries no payload, it is purely a
 * periodic *trigger* ("run one FX-rate ingestion cycle"), consumed by
 * `apps/worker`'s own `FxRateIngestionProcessor`/`FxRateIngestionScheduler`.
 * `attempts: 1` for the identical reason — the next scheduled firing
 * already provides retry for a failed cycle, and `IngestFxRatesUseCase`
 * itself never throws (it returns a failure summary instead).
 */
export const FX_RATE_INGESTION_QUEUE_NAME = 'fx-rate-ingestion';

@Module({
  imports: [
    BullModule.registerQueue({
      name: FX_RATE_INGESTION_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  exports: [BullModule],
})
export class FxRateIngestionQueueModule {}

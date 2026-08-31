import { Module } from '@nestjs/common';
import { FxRateIngestionModule as FxRateIngestionUseCaseModule } from '@afa/application';
import {
  CurrencyRepositoryModule,
  FxRateIngestionQueueModule,
  FxRateProviderModule,
  FxRateRepositoryModule,
} from '@afa/infrastructure';

import { FxRateIngestionProcessor } from './fx-rate-ingestion.processor';
import { FxRateIngestionScheduler } from './fx-rate-ingestion.scheduler';

/**
 * TASK-FIN-007 Stage F — composition-root wiring, mirroring
 * `BudgetRolloverModule`'s own shape exactly.
 */
@Module({
  imports: [
    FxRateIngestionUseCaseModule,
    CurrencyRepositoryModule,
    FxRateRepositoryModule,
    FxRateProviderModule,
    FxRateIngestionQueueModule,
  ],
  providers: [FxRateIngestionProcessor, FxRateIngestionScheduler],
})
export class FxRateIngestionModule {}

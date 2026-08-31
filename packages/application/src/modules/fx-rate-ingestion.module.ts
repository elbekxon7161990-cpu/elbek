import { Module } from '@nestjs/common';

import { IngestFxRatesUseCase } from '../use-cases/ingest-fx-rates.use-case';

/**
 * TASK-FIN-007 Stage F (FR-INT-001/002/003) — does not bind
 * CURRENCY_REPOSITORY/FX_RATE_PROVIDER/FX_RATE_REPOSITORY — same
 * composition-root split as every other module in this package; binding
 * those domain ports to their infrastructure implementations is
 * apps/worker's own bootstrap job.
 */
@Module({
  providers: [IngestFxRatesUseCase],
  exports: [IngestFxRatesUseCase],
})
export class FxRateIngestionModule {}

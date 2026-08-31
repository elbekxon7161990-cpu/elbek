import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { IngestFxRatesUseCase } from '@afa/application';
import { FX_RATE_INGESTION_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-FIN-007 Stage F — the thin BullMQ wiring for one ingestion cycle,
 * mirroring `BudgetRolloverProcessor`'s own exact shape. All real policy
 * (which currencies, the per-base failure isolation) lives in
 * `IngestFxRatesUseCase` (`@afa/application`), already fully unit-tested
 * with a fake provider/repository; this class only triggers and reports.
 *
 * Never logs individual rate values — only aggregate counts and which base
 * currencies failed, matching `BudgetRolloverProcessor`'s own Chapter 16
 * §16.3 data-minimization discipline (rates aren't user data, but the same
 * "logs report shape, not content" discipline applies).
 */
@Processor(FX_RATE_INGESTION_QUEUE_NAME)
@Injectable()
export class FxRateIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(FxRateIngestionProcessor.name);

  constructor(private readonly ingestFxRates: IngestFxRatesUseCase) {
    super();
  }

  async process(): Promise<{
    basesAttempted: number;
    basesSucceeded: number;
    ratesUpserted: number;
  }> {
    const summary = await this.ingestFxRates.execute();

    if (summary.failures.length > 0) {
      this.logger.warn(
        `FX-rate ingestion: ${summary.basesSucceeded}/${summary.basesAttempted} base(s) succeeded, ` +
          `${summary.ratesUpserted} rate(s) upserted, ${summary.failures.length} base(s) failed: ` +
          summary.failures.map((f) => f.baseCurrency).join(', '),
      );
    } else {
      this.logger.log(
        `FX-rate ingestion: ${summary.basesSucceeded}/${summary.basesAttempted} base(s) succeeded, ` +
          `${summary.ratesUpserted} rate(s) upserted.`,
      );
    }

    return {
      basesAttempted: summary.basesAttempted,
      basesSucceeded: summary.basesSucceeded,
      ratesUpserted: summary.ratesUpserted,
    };
  }
}

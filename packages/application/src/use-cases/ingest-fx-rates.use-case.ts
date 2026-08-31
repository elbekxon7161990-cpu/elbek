import { Inject, Injectable } from '@nestjs/common';
import type { CurrencyRepository, FxRateProvider, FxRateRepository } from '@afa/domain';
import { CURRENCY_REPOSITORY, FX_RATE_PROVIDER, FX_RATE_REPOSITORY } from '@afa/domain';

export interface IngestFxRatesFailure {
  baseCurrency: string;
  error: string;
}

export interface IngestFxRatesSummary {
  asOfDate: Date;
  basesAttempted: number;
  basesSucceeded: number;
  ratesUpserted: number;
  failures: IngestFxRatesFailure[];
}

function toCalendarDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * TASK-FIN-007 (Stage F, FR-INT-003 — "refreshed at least daily", FR-FIN-028).
 * Same "policy above, mechanics below, never throws, returns a summary"
 * shape as `RolloverBudgetPeriodsUseCase` — a scheduled worker cycle must
 * never crash the process over one bad currency pair.
 *
 * FR-INT-002 (documented fallback/degradation): a `FxRateProvider` failure
 * for one base currency is caught and recorded in `failures`, then ingestion
 * continues for the remaining bases — one vendor hiccup never blocks the
 * whole refresh. The next scheduled run retries the failed base naturally;
 * in the meantime, `FxRateRepository.findRate`'s own already-built fallback
 * (Stage C) degrades gracefully for that pair using the most recent prior
 * rate. Idempotency comes from `FxRateRepository.recordRate`'s existing
 * `(baseCurrency, quoteCurrency, asOfDate)` upsert (Stage C, unchanged) — a
 * re-run for the same day safely overwrites rather than duplicating.
 */
@Injectable()
export class IngestFxRatesUseCase {
  constructor(
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(FX_RATE_PROVIDER) private readonly fxRateProvider: FxRateProvider,
    @Inject(FX_RATE_REPOSITORY) private readonly fxRateRepository: FxRateRepository,
  ) {}

  async execute(now: Date = new Date()): Promise<IngestFxRatesSummary> {
    const asOfDate = toCalendarDateOnly(now);
    const activeCurrencies = await this.currencyRepository.listActiveCodes();

    let basesSucceeded = 0;
    let ratesUpserted = 0;
    const failures: IngestFxRatesFailure[] = [];

    for (const baseCurrency of activeCurrencies) {
      const quoteCurrencies = activeCurrencies.filter((code) => code !== baseCurrency);
      if (quoteCurrencies.length === 0) {
        continue;
      }

      try {
        const quotes = await this.fxRateProvider.fetchRates(baseCurrency, quoteCurrencies);
        for (const quote of quotes) {
          await this.fxRateRepository.recordRate({
            baseCurrency,
            quoteCurrency: quote.quoteCurrency,
            rate: quote.rate,
            asOfDate,
            source: 'daily-ingestion',
          });
          ratesUpserted += 1;
        }
        basesSucceeded += 1;
      } catch (error) {
        failures.push({
          baseCurrency,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      asOfDate,
      basesAttempted: activeCurrencies.length,
      basesSucceeded,
      ratesUpserted,
      failures,
    };
  }
}

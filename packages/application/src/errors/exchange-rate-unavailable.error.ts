import { ApplicationError } from './application.error';

/**
 * FR-FIN-043 generalized to the write path — a cross-currency transaction
 * with no exchange rate available at all (not even a stale fallback per
 * FR-FIN-029) must fail loudly rather than silently persist a `null`
 * snapshot, which would corrupt every future §8.14 calculation touching
 * that record. Expected until TASK-FIN-007 Stage F's FX ingestion mechanism
 * has recorded at least one rate for the pair.
 */
export class ExchangeRateUnavailableError extends ApplicationError {
  constructor(fromCurrency: string, toCurrency: string) {
    super(
      `No exchange rate available for ${fromCurrency} -> ${toCurrency} (not even a stale fallback).`,
    );
  }
}

import type { FxRateRepository } from '@afa/domain';

import { ExchangeRateUnavailableError } from '../errors/exchange-rate-unavailable.error';

/**
 * TASK-FIN-007 (Stage E, FR-FIN-027/028/029, BR-FIN-006) — shared by
 * `CreateExpenseUseCase`/`CreateIncomeUseCase`.
 *
 * Same-currency transactions never call `FxRateRepository` at all — the
 * rate is implicitly `'1'`, the design rule Stage C's own `FxRateRepository`
 * doc comment already established ("a same-currency snapshot is always
 * exactly '1', computed by the caller ... without ever calling this port").
 *
 * A cross-currency transaction is captured against `transactionDate` (its
 * own logged date, not "now") — BR-FIN-006's "that transaction's own stored
 * snapshot rate", never a rate re-derived later. `FxRateRepository.findRate`
 * already implements FR-FIN-029's exact-date/prior-date-fallback lookup;
 * this function only decides what to do with the result — use it if found
 * (exact or approximate; "approximate" is a downstream-display concern per
 * FR-FIN-029's own text, not a storage concern), or fail loudly
 * (`ExchangeRateUnavailableError`, FR-FIN-043's principle generalized to the
 * write path) if no rate exists for the pair at all.
 */
export async function resolveTransactionExchangeRate(
  fxRateRepository: FxRateRepository,
  currency: string,
  defaultCurrency: string,
  transactionDate: Date,
): Promise<string> {
  if (currency === defaultCurrency) {
    return '1';
  }

  const result = await fxRateRepository.findRate(currency, defaultCurrency, transactionDate);
  if (!result) {
    throw new ExchangeRateUnavailableError(currency, defaultCurrency);
  }
  return result.rate;
}

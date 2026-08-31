import { isValidCurrencyCode, isValidPositiveDecimalRate } from '../entities/decimal-amount';
import { InvalidFxRateError } from '../errors/invalid-fx-rate.error';
import type { NewFxRateData } from '../repositories/fx-rate.repository';

/**
 * TASK-FIN-007 (Stage C) — `fx_rates` has no domain entity/aggregate of its
 * own (see `FxRateRepository`'s own doc comment for why); this pure
 * function is where its write-time invariants live instead, mirroring the
 * "pure function, not a class" pattern already established for non-
 * aggregate business rules (`evaluateBudgetThresholdCrossing`,
 * `matchesBudgetCategoryScope`) — reusable by `PrismaFxRateRepository.recordRate()`
 * (Stage C) and independently unit-testable, without inventing a full
 * `FxRate` class for what is fundamentally reference data with no user-
 * facing lifecycle.
 */
export function validateNewFxRateData(data: NewFxRateData, now: Date = new Date()): void {
  if (!isValidCurrencyCode(data.baseCurrency)) {
    throw new InvalidFxRateError(
      `baseCurrency must be a 3-letter ISO 4217 code, got "${data.baseCurrency}".`,
    );
  }
  if (!isValidCurrencyCode(data.quoteCurrency)) {
    throw new InvalidFxRateError(
      `quoteCurrency must be a 3-letter ISO 4217 code, got "${data.quoteCurrency}".`,
    );
  }
  if (data.baseCurrency === data.quoteCurrency) {
    throw new InvalidFxRateError(
      `baseCurrency and quoteCurrency must differ, both were "${data.baseCurrency}" — a same-currency rate is always implicitly 1, never recorded (see FxRateRepository's own doc comment).`,
    );
  }
  // A rate of 0 or negative has no real-world meaning (per §8.13.2 FR-FIN-028's
  // own "exchange rate" framing). TASK-FIN-008 precision-bug fix: this
  // previously used `isValidDecimalAmount` (the 2-decimal MONEY validator),
  // which silently rejected any rate needing more than 2 decimal places —
  // `fx_rates.rate` is `Decimal(18,8)` (§13.8), not a money field;
  // `isValidPositiveDecimalRate` matches that column's own precision.
  if (!isValidPositiveDecimalRate(data.rate)) {
    throw new InvalidFxRateError(`rate must be a positive decimal value, got "${data.rate}".`);
  }
  if (!(data.asOfDate instanceof Date) || Number.isNaN(data.asOfDate.getTime())) {
    throw new InvalidFxRateError('asOfDate must be a valid Date.');
  }
  if (data.asOfDate.getTime() > now.getTime()) {
    throw new InvalidFxRateError('asOfDate cannot be in the future.');
  }
}

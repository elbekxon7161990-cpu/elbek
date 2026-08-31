import type { TransactionExtractionCandidate } from './transaction-extraction-schema';

/**
 * TASK-AI-003 (Chapter 4 §4.8 layer 5 "Numeric sanity bounds" — "catches
 * both hallucination and OCR/STT misread errors (e.g., '240,000' misheard
 * as '2,400,000')").
 *
 * Deliberately DOES NOT reimplement the historical-average large-amount
 * check — that check (`evaluateLargeAmountSanityCheck`,
 * `packages/application/src/use-cases/evaluate-large-amount-sanity-check.ts`)
 * already exists, requires a specific user's real transaction history via
 * `ExpenseHistoryRepository`, and is correctly enforced at the Domain
 * Service layer (Chapter 8 §8.1.4, TASK-FIN-001), per §4.10's own
 * architectural rule: "validation rules are enforced in code [at the
 * Domain Service], not trusted from the model." Duplicating it here, at
 * the AI layer, with no database access, would either be a no-op stub or
 * a second, drifting copy of the same rule.
 *
 * What THIS layer catches instead — a database-free, currency-agnostic,
 * deliberately coarse net that has no equivalent anywhere else in the
 * codebase:
 *   - an absolute magnitude ceiling on `amount`, generous enough to never
 *     trip on any real personal-finance transaction, but low enough to
 *     catch obvious scale/parsing errors (e.g. a misplaced decimal or a
 *     misheard digit run).
 *   - an absolute plausibility window on `transactionDate`/`dueDate` —
 *     distinct from Chapter 8's precise, timezone-aware "not in the
 *     future" business rule (`BR-EXP-002`) — this only catches dates so
 *     far outside any plausible range (e.g. year 9999, or a due date
 *     centuries out) that they are almost certainly a parsing artifact,
 *     not a real business-rule boundary case.
 */

/** No currency in this product's scope plausibly has a single transaction at or above this magnitude; anything higher is treated as a scale/parsing error. */
const ABSOLUTE_AMOUNT_CEILING = 1_000_000_000_000_000; // 10^15

const MIN_PLAUSIBLE_YEAR = 2000;
/** transactionDate is "already happened" by definition; a few days of slack absorbs timezone/clock skew without turning this into a precision check (that precision belongs to Chapter 8's BR-EXP-002). */
const TRANSACTION_DATE_MAX_FUTURE_DAYS = 7;
/** dueDate is expected to be in the future (a debt repayment date); allow a wide but bounded window. */
const DUE_DATE_MAX_FUTURE_YEARS = 10;

function parseIsoDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

export function evaluateAmountSanityBound(amount: number): boolean {
  return Number.isFinite(amount) && Math.abs(amount) <= ABSOLUTE_AMOUNT_CEILING;
}

export function evaluateTransactionDateSanityBound(
  transactionDate: string,
  currentDateTime: string,
): boolean {
  const date = parseIsoDate(transactionDate);
  const now = new Date(currentDateTime);
  if (date === null || Number.isNaN(now.getTime())) {
    return false;
  }
  const minDate = new Date(Date.UTC(MIN_PLAUSIBLE_YEAR, 0, 1));
  const maxDate = addDays(now, TRANSACTION_DATE_MAX_FUTURE_DAYS);
  return date >= minDate && date <= maxDate;
}

export function evaluateDueDateSanityBound(dueDate: string, currentDateTime: string): boolean {
  const date = parseIsoDate(dueDate);
  const now = new Date(currentDateTime);
  if (date === null || Number.isNaN(now.getTime())) {
    return false;
  }
  const minDate = new Date(Date.UTC(MIN_PLAUSIBLE_YEAR, 0, 1));
  const maxDate = addYears(now, DUE_DATE_MAX_FUTURE_YEARS);
  return date >= minDate && date <= maxDate;
}

export interface SanityBoundResult {
  candidate: TransactionExtractionCandidate;
  /** Field names nulled because they fell outside a plausible sanity bound. */
  flaggedFields: readonly string[];
}

export function applySanityBounds(
  candidate: TransactionExtractionCandidate,
  currentDateTime: string,
): SanityBoundResult {
  const flaggedFields: string[] = [];
  const patch: Partial<TransactionExtractionCandidate> = {};

  if (candidate.amount !== null && !evaluateAmountSanityBound(candidate.amount)) {
    flaggedFields.push('amount');
    patch.amount = null;
  }

  if (
    candidate.transactionDate !== null &&
    !evaluateTransactionDateSanityBound(candidate.transactionDate, currentDateTime)
  ) {
    flaggedFields.push('transactionDate');
    patch.transactionDate = null;
  }

  if (
    candidate.dueDate !== null &&
    !evaluateDueDateSanityBound(candidate.dueDate, currentDateTime)
  ) {
    flaggedFields.push('dueDate');
    patch.dueDate = null;
  }

  return {
    candidate: flaggedFields.length === 0 ? candidate : { ...candidate, ...patch },
    flaggedFields,
  };
}

import { roundDecimalAmountToScale } from '@afa/domain';

/**
 * `Prisma.Decimal#toString()` trims trailing zeros (`"15000.00"` →
 * `"15000"`) — confirmed empirically against real Postgres, first while
 * building TASK-REP-007 (`prisma-report-query.repository.ts`'s own
 * previously file-local copy of this exact function), and reconfirmed here
 * building TASK-FIN-002's `debt.mapper.ts`. Extracted to this shared
 * location once a second file needed the identical fix, rather than a
 * second, independently-maintained copy of the same logic (the atomic-
 * validation lesson's "reuse a canonical implementation" principle applied
 * here to decimal formatting). Works for a `Prisma.Decimal`, a raw
 * `$queryRaw` numeric result, or a plain string uniformly — all of them
 * stringify to a decimal-looking value first either way.
 *
 * Money-only: every caller of this function is a `Decimal(18,2)` money
 * column (`amount`, `starting_balance`, `limit_amount`, etc.), where a
 * fixed 2-decimal canonical format is an established, real requirement.
 * `FxRate.rate`/`Transaction.exchangeRateToDefault` (`Decimal(18,8)`) are
 * deliberately NOT run through this function — forcing 2 decimals onto a
 * rate would truncate real precision, and there is no PRD/schema
 * requirement that a rate display with any fixed decimal-place count, so
 * `Decimal#toString()`'s own natural (trailing-zero-trimmed but never
 * significant-digit-losing) output is used for those two fields instead
 * (`prisma-fx-rate.repository.ts`/`loan.mapper.ts`, TASK-FIN-008 precision
 * audit — this function was previously, incorrectly, applied to `FxRate.rate`
 * at one call site; that has been fixed to use bare `Decimal#toString()`
 * instead, matching this file's own documented contract).
 *
 * TASK-FIN-008 (precision-bug fix) — rounds via `roundDecimalAmountToScale`
 * (canonical BigInt HALF-UP, `@afa/domain`), NOT the previous
 * `.slice(0, 2)` truncation. For every caller feeding an already-2-decimal
 * `Decimal(18,2)` value (the overwhelming majority), this is a no-op
 * behavior change (nothing beyond scale 2 exists to round). The one path
 * this actually changes: `compute-account-balance.ts`'s/
 * `compute-savings-goal-progress.ts`'s cross-currency `SUM` branch
 * (`amount * fx.rate`, a wider-than-2-decimal Postgres `NUMERIC`
 * intermediate) now rounds a genuine 3rd-decimal-or-later digit ≥5 up
 * instead of silently dropping it — the correct behavior for a function
 * whose own file (`decimal-amount.ts`) already documents HALF-UP as "the
 * only rounding convention this codebase states or implies."
 */
export function formatDecimalAmount(
  value: { toString(): string } | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '0.00';
  }
  const str = typeof value === 'string' ? value : value.toString();
  return roundDecimalAmountToScale(str, 2);
}

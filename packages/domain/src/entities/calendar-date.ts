/**
 * TASK-FIN-010 — extracted from `Transaction`/`Debt`/`SavingsGoal`'s
 * previously independent, module-private `isFutureDate`/`toCalendarDateOnly`
 * helpers (all three truncated to UTC calendar-day granularity before
 * comparing, byte-identical in that respect) so the three entities share one
 * canonical implementation instead of three independently-maintained copies
 * — the same "extract once a second consumer needs the exact same rule"
 * pattern `decimal-amount.ts` already established for its own money/currency
 * primitives.
 *
 * `validate-new-fx-rate-data.ts`'s own future-date check is deliberately NOT
 * unified here — it compares raw milliseconds (not calendar-day-truncated)
 * and explicitly rejects an invalid `Date`, both genuinely different
 * semantics from the calendar-day family below.
 */

/**
 * Calendar-day (UTC) comparison of two `Date` values, mirroring
 * `compareDecimalAmounts`'s own contract: `-1` if `a`'s UTC calendar day is
 * earlier than `b`'s, `1` if later, `0` if the same UTC calendar day
 * (regardless of either value's time-of-day). Encodes only the shared
 * comparison — which result means "reject" is a business decision left to
 * each caller, not this function.
 *
 * Returns `0` (never `-1`/`1`) when either input is an invalid `Date` —
 * this reproduces the exact behavior of the three prior independent
 * implementations, none of which validated `Date` validity: a `>`/`<`
 * comparison against `NaN` is always `false`, so an invalid date on either
 * side never caused a rejection. This function is not the place to change
 * that; each entity's own invalid-Date policy (or lack of one) is
 * preserved unchanged at the call site.
 */
export function compareCalendarDateOnly(a: Date, b: Date): -1 | 0 | 1 {
  const aDateOnly = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bDateOnly = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  if (Number.isNaN(aDateOnly) || Number.isNaN(bDateOnly)) {
    return 0;
  }
  if (aDateOnly === bDateOnly) {
    return 0;
  }
  return aDateOnly < bDateOnly ? -1 : 1;
}

/**
 * FR-EXP-004 — "if `amount` exceeds N× the user's trailing 90-day average
 * expense (default threshold: 10×, admin-configurable)...". No admin/
 * settings system exists yet to make this configurable (a later, unbuilt
 * task) — this is the PRD's own stated default, used as a fixed constant
 * until that mechanism exists.
 */
export const DEFAULT_LARGE_AMOUNT_SANITY_MULTIPLIER = 10;

/**
 * Scales a canonical decimal string (e.g. "45000.00") to a `bigint` at the
 * given number of fractional digits, without ever passing through a JS
 * `number` — the same DB-P3/FR-DB-027 constraint `transaction.entity.ts`
 * and the infrastructure mapper already document and follow.
 */
function toScaledBigInt(value: string, scale: number): bigint {
  const [integerPart, fractionPart = ''] = value.split('.');
  const paddedFraction = fractionPart.padEnd(scale, '0');
  return BigInt(integerPart + paddedFraction);
}

/**
 * `value > multiplier × baseline`, compared exactly via `bigint` — no
 * float, no precision loss, regardless of how many decimal places either
 * operand carries (a database `AVG()` can return more decimal places than
 * the `NUMERIC(18,2)` amounts it was computed from).
 */
function exceedsMultiple(value: string, baseline: string, multiplier: number): boolean {
  const scale = Math.max((value.split('.')[1] ?? '').length, (baseline.split('.')[1] ?? '').length);
  const valueScaled = toScaledBigInt(value, scale);
  const baselineScaled = toScaledBigInt(baseline, scale);
  return valueScaled > baselineScaled * BigInt(multiplier);
}

/**
 * FR-EXP-004's decision only — never blocks, only flags. `trailingAverage
 * === null` (no matching history) means there is nothing to compare
 * against, so the check never fires — an absent baseline must never
 * produce a false positive.
 */
export function evaluateLargeAmountSanityCheck(
  amount: string,
  trailingAverageAmount: string | null,
  multiplier: number = DEFAULT_LARGE_AMOUNT_SANITY_MULTIPLIER,
): boolean {
  if (trailingAverageAmount === null) {
    return false;
  }
  return exceedsMultiple(amount, trailingAverageAmount, multiplier);
}

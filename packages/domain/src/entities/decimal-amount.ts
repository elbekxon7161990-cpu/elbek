/**
 * TASK-FIN-002 — extracted from `transaction.entity.ts`'s previously
 * module-private `isValidAmount`/`isNonEmpty`/currency-regex helpers so
 * `Debt`/`DebtRepayment` (a second entity family with the exact same
 * "positive decimal string, max 2 decimal places" / "3-letter ISO 4217
 * code" rules — §8.3.6, mirroring §8.1.6/§8.2.6) can reuse the same
 * canonical implementation instead of a second, independently-maintained
 * copy of the same regexes (the lesson applied by the recent Transaction
 * Create Atomic Validation Fix to `normalizeTransactionInput`, applied here
 * to this smaller shared rule set). `transaction.entity.ts` itself now
 * imports from here too — see that file's own diff.
 */

// §8.1.6/§8.3.6 — "Positive decimal, max 2 decimal places for currencies
// that use subunits". Per-currency subunit awareness (currencies.decimal_places)
// needs a reference-table lookup the domain layer doesn't have, so this is a
// conservative 2-decimal-place ceiling, not the fully currency-aware rule.
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * `amount`-style fields are canonical decimal strings, never a native
 * `number` — DB-P3/FR-DB-027 (Chapter 13) forbid representing money as
 * IEEE-754 float anywhere in the stack, including the application boundary.
 */
export function isValidDecimalAmount(value: string): boolean {
  return DECIMAL_PATTERN.test(value) && /[1-9]/.test(value);
}

/** Like `isValidDecimalAmount`, but also accepts zero — for balances that can legitimately reach zero (e.g. a fully repaid debt), unlike a transaction amount (CHECK amount > 0) or a repayment amount (CHECK amount > 0), which must always be strictly positive. */
export function isValidNonNegativeDecimalAmount(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/**
 * TASK-FIN-007 (§8.12.3 — Account `starting_balance`: "Any decimal (may be
 * negative, e.g., a credit-card-style account with an existing balance
 * owed)"). The one signed-amount case in this codebase — every other
 * decimal validator here is deliberately unsigned (a transaction/repayment
 * amount, a budget limit, are never negative) — so this is a genuinely new
 * validator, not a relaxation of an existing one, kept separate rather than
 * adding an "allow negative" flag to `isValidDecimalAmount` and risking a
 * caller accidentally opting a positive-only field into negative values.
 */
const SIGNED_DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function isValidSignedDecimalAmount(value: string): boolean {
  return SIGNED_DECIMAL_PATTERN.test(value);
}

/**
 * TASK-FIN-004 (Stage F, §13.20.3) — `loans.interest_rate` is `NUMERIC(6,4)`,
 * documented explicitly as "Annual rate as a decimal fraction" (e.g.
 * `"0.1200"` for 12%, `"0.1235"` for 12.35%) — NOT a whole-number percentage.
 * This was corrected after an initial Stage F implementation incorrectly
 * treated it as a 2-decimal-place percentage requiring `/100`; that
 * convention has been fully removed (see `compute-loan-amortization.ts`).
 *
 * The pattern mirrors the column's own `NUMERIC(6,4)` precision/scale
 * exactly (6 total digits, 4 after the point, leaving at most 2 digits
 * before it) rather than reusing `DECIMAL_PATTERN`'s money-field 2-decimal
 * ceiling, which would reject legitimate rate precision the column itself
 * supports (e.g. `"0.1235"`).
 */
const DECIMAL_FRACTION_PATTERN = /^\d{1,2}(\.\d{1,4})?$/;

export function isValidNonNegativeDecimalFraction(value: string): boolean {
  return DECIMAL_FRACTION_PATTERN.test(value);
}

/**
 * TASK-FIN-008 (precision-bug fix) — `fx_rates.rate` is `Decimal(18,8)`
 * (§13.8), a materially different precision than either
 * `DECIMAL_PATTERN`'s money-field 2-decimal ceiling or
 * `DECIMAL_FRACTION_PATTERN`'s `NUMERIC(6,4)` (4-decimal, 2-integer-digit)
 * shape — neither fits. `validate-new-fx-rate-data.ts` previously (and
 * incorrectly) validated `rate` with `isValidDecimalAmount` (the
 * money-field validator), which silently REJECTED any genuine
 * rate needing more than 2 decimal places — found via this task's own
 * regression test for the sibling `formatDecimalAmount`/
 * `prisma-fx-rate.repository.ts` truncation bug, which could not even
 * construct a valid 8-decimal fixture without first fixing this. Matches
 * the column's own `NUMERIC(18,8)` precision/scale exactly (up to 10
 * integer digits, up to 8 fractional), strictly positive (a zero or
 * negative exchange rate has no real-world meaning, same bound
 * `isValidDecimalAmount` already enforces for money).
 */
const POSITIVE_DECIMAL_RATE_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

export function isValidPositiveDecimalRate(value: string): boolean {
  return POSITIVE_DECIMAL_RATE_PATTERN.test(value) && /[1-9]/.test(value);
}

export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

export function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function decimalPlacesOf(value: string): number {
  return value.includes('.') ? value.split('.')[1]!.length : 0;
}

function toBigIntScaled(value: string, scale: number): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole! + fraction.padEnd(scale, '0'));
}

/**
 * Precision-safe comparison of two canonical decimal-string amounts,
 * via BigInt scaling — never a JS-float `Number()` conversion, which can
 * silently lose precision (DB-P3/FR-DB-027). Same contract as
 * `Array.prototype.sort`'s comparator: negative if `a < b`, positive if
 * `a > b`, `0` if equal.
 */
export function compareDecimalAmounts(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(decimalPlacesOf(a), decimalPlacesOf(b));
  const scaledA = toBigIntScaled(a, scale);
  const scaledB = toBigIntScaled(b, scale);
  if (scaledA === scaledB) return 0;
  return scaledA < scaledB ? -1 : 1;
}

/** Precision-safe `a - b`, returning a canonical decimal string at the wider of the two inputs' scales. Callers are responsible for ensuring the result is meaningful (e.g. non-negative) — this function performs no invariant checks of its own. */
export function subtractDecimalAmounts(a: string, b: string): string {
  const scale = Math.max(decimalPlacesOf(a), decimalPlacesOf(b));
  const result = toBigIntScaled(a, scale) - toBigIntScaled(b, scale);
  return fromBigIntScaled(result, scale);
}

/**
 * TASK-FIN-008 — precision-safe `a + b`, returning a canonical decimal
 * string at the wider of the two inputs' scales. The canonical replacement
 * for `prisma-report-query.repository.ts`'s own previously file-local
 * `addDecimalStrings` (a fixed-scale-2, money-only duplicate of this exact
 * BigInt-scaling shape) — extracted here once a second, more general
 * consumer existed, the same "reuse a canonical implementation" principle
 * `format-decimal-amount.ts` already established for its own extraction.
 */
export function addDecimalAmounts(a: string, b: string): string {
  const scale = Math.max(decimalPlacesOf(a), decimalPlacesOf(b));
  const result = toBigIntScaled(a, scale) + toBigIntScaled(b, scale);
  return fromBigIntScaled(result, scale);
}

/** Renders a scaled `BigInt` (possibly negative) back into a canonical decimal string at the given `scale` — the shared last step `subtractDecimalAmounts`/`multiplyDecimalAmounts`/`divideDecimalAmountByInteger` all need, extracted once rather than re-implemented per function. */
function fromBigIntScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * TASK-FIN-004 (Stage F, §8.14.6) — precision-safe `a * b`, returning a
 * canonical decimal string at the COMBINED scale (sum of the two inputs'
 * own decimal places) — exact, no rounding, since multiplying two
 * finite-scale decimals always produces a finite-scale (if wider) result.
 * The first new decimal-arithmetic primitive this codebase has needed
 * beyond compare/subtract — TASK-FIN-004 Stage A explicitly deferred
 * building one until a real, approved consumer existed (§8.14.6's
 * amortization formula, `compute-loan-amortization.ts`); this is that
 * consumer.
 */
export function multiplyDecimalAmounts(a: string, b: string): string {
  const scaleA = decimalPlacesOf(a);
  const scaleB = decimalPlacesOf(b);
  const combinedScale = scaleA + scaleB;
  const product = toBigIntScaled(a, scaleA) * toBigIntScaled(b, scaleB);
  return fromBigIntScaled(product, combinedScale);
}

/**
 * TASK-FIN-004 (Stage F, §8.14.6) — precision-safe `a / divisor`
 * (`divisor` a plain positive integer — every division §8.14.6's formula
 * needs is by `installments_per_year` or the interest-rate-to-fraction
 * `100`, never by another arbitrary decimal), rounded HALF-UP to
 * `roundToScale` decimal places. Half-up (round `0.5` away from zero, the
 * conventional default for money) is the only rounding convention this
 * codebase states or implies anywhere else — no other money-scale rounding
 * rule exists to be inconsistent with, and every other money field in this
 * codebase is a direct, unrounded write, never a computed-then-rounded one,
 * so there is no established precedent to defer to beyond this standard
 * convention.
 */
export function divideDecimalAmountByInteger(
  a: string,
  divisor: number,
  roundToScale: number,
): string {
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new RangeError(`divisor must be a positive integer, got ${divisor}.`);
  }
  // Worked entirely in absolute-value space and re-signed at the end, so
  // the rounding direction (away from zero on a tie) is unambiguous
  // regardless of `a`'s own sign. `a` is scaled by its OWN native decimal
  // places first (exact, via `toBigIntScaled`'s already-correct same-scale
  // case), then the target scale is introduced by multiplying the
  // numerator — rather than asking `toBigIntScaled` for a `scale` smaller
  // than `a`'s own (which it cannot truncate to, only pad up to).
  const scaleA = decimalPlacesOf(a);
  const aScaled = toBigIntScaled(a, scaleA);
  const isNegative = aScaled < 0n;
  const absA = isNegative ? -aScaled : aScaled;
  const numerator = absA * 10n ** BigInt(roundToScale);
  const denominator = 10n ** BigInt(scaleA) * BigInt(divisor);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedMagnitude = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return fromBigIntScaled(isNegative ? -roundedMagnitude : roundedMagnitude, roundToScale);
}

/**
 * TASK-FIN-008 — canonical HALF-UP (round half away from zero) rounding of
 * a decimal-string amount to an arbitrary target `scale`, extracted as a
 * standalone primitive from `divideDecimalAmountByInteger`'s own identical
 * tie-breaking rule (`remainder * 2n >= denominator ? quotient + 1n :
 * quotient`) — the general "just round this value to N decimals" shape
 * that operation's own division-specific formula doesn't directly expose.
 *
 * This is `format-decimal-amount.ts`'s `formatDecimalAmount`'s new
 * implementation basis (TASK-FIN-008 precision-bug fix): that function
 * previously TRUNCATED (`.slice(0, 2)` on the fraction string) rather than
 * rounding, silently dropping a genuine 3rd-decimal-or-later digit ≥5
 * instead of carrying it — on the one path where callers actually feed it
 * a wider-than-2-decimal intermediate value
 * (`compute-account-balance.ts`/`compute-savings-goal-progress.ts`'s
 * cross-currency `SUM` branch, `amount * fx.rate`, a `Decimal(18,2) *
 * Decimal(18,8)` Postgres computation that can carry real precision past
 * 2 decimals). For every OTHER caller — a plain `Decimal(18,2)` column
 * read, already at or below 2 decimals — this produces the exact same
 * output truncation did (there is nothing beyond the target scale to
 * round), so this change is behavior-preserving everywhere except the one
 * path it was meant to fix.
 *
 * If `value` already has `decimalPlacesOf(value) &lt;= scale`, no rounding
 * is needed or attempted — the value is simply zero-padded to the target
 * scale (via `toBigIntScaled`'s own exact, pad-only behavior), never
 * routed through the divide-and-round branch below (which assumes a
 * STRICTLY wider native scale, and would misparse a same-or-narrower one
 * if given to it, since `toBigIntScaled` only ever pads, never truncates).
 */
export function roundDecimalAmountToScale(value: string, scale: number): string {
  const nativeScale = decimalPlacesOf(value);
  if (nativeScale <= scale) {
    return fromBigIntScaled(toBigIntScaled(value, scale), scale);
  }
  const scaledAtNative = toBigIntScaled(value, nativeScale);
  const isNegative = scaledAtNative < 0n;
  const magnitude = isNegative ? -scaledAtNative : scaledAtNative;
  const divisor = 10n ** BigInt(nativeScale - scale);
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const roundedMagnitude = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return fromBigIntScaled(isNegative ? -roundedMagnitude : roundedMagnitude, scale);
}

/**
 * TASK-FIN-008 (§8.14.4 `budget_utilization`, §8.14.5 `goal_progress`) — the
 * ONE shared implementation of "what percent is `amount` of `target`",
 * per FR-FIN-031 ("no consumer may reimplement the formula independently").
 * Previously three byte-near-identical, independently-maintained copies:
 * `evaluate-budget-thresholds-on-expense-commit.ts`'s own file-local
 * `percentOf`, `compute-savings-goal-progress.ts`'s own file-local
 * `percentOf` (textually identical to the first), and
 * `prisma-budget.repository.ts`'s own inline `utilizationPercent`
 * expression (which omitted the `Number.isFinite` guard the other two
 * had — a difference with no observable effect today, since `target`
 * always originates from a canonical decimal string via
 * `formatDecimalAmount`, but a real, if harmless, divergence
 * nonetheless).
 *
 * Deliberately a plain `Number()`-based `number` result, NOT the
 * BigInt-safe decimal-string arithmetic every other function in this file
 * uses: this returns a comparison/display figure (e.g. "42" meaning 42%),
 * never a value written back to a money column, so DB-P3/FR-DB-027's
 * float ban (which governs stored monetary amounts) does not apply —
 * exactly the exemption both prior copies' own doc comments already
 * argued independently. Output convention is a 0–100 SCALED PERCENTAGE
 * (multiplied by 100), matching every existing consumer/test/acceptance-
 * criterion (AC-FIN-004 describes `goal_progress`'s own output as
 * "exactly 25%", not "0.25") — PRD §8.14.4/§8.14.5 state the underlying
 * formula as an unscaled ratio and are silent on this convention; the
 * ×100-scaled reading is the codebase's own long-established, product-
 * confirmed choice, preserved here unchanged, not re-derived.
 *
 * Behavior preserved EXACTLY from all three prior copies: `target <= 0`
 * or non-finite yields `0`, never `Infinity`/`NaN`/a divide-by-zero throw.
 */
export function percentOf(amount: string, target: string): number {
  const targetValue = Number(target);
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    return 0;
  }
  return (Number(amount) / targetValue) * 100;
}

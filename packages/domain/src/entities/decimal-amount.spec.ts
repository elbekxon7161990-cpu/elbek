import { describe, expect, it } from 'vitest';

import {
  addDecimalAmounts,
  compareDecimalAmounts,
  divideDecimalAmountByInteger,
  isNonEmptyString,
  isValidCurrencyCode,
  isValidDecimalAmount,
  isValidNonNegativeDecimalAmount,
  isValidNonNegativeDecimalFraction,
  isValidPositiveDecimalRate,
  isValidSignedDecimalAmount,
  multiplyDecimalAmounts,
  percentOf,
  roundDecimalAmountToScale,
  subtractDecimalAmounts,
} from './decimal-amount';

describe('isValidDecimalAmount', () => {
  it('accepts a plain positive integer', () => {
    expect(isValidDecimalAmount('45000')).toBe(true);
  });

  it('accepts up to 2 decimal places', () => {
    expect(isValidDecimalAmount('45000.50')).toBe(true);
    expect(isValidDecimalAmount('0.01')).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidDecimalAmount('0')).toBe(false);
    expect(isValidDecimalAmount('0.00')).toBe(false);
  });

  it('rejects negative values', () => {
    expect(isValidDecimalAmount('-500')).toBe(false);
  });

  it('rejects more than 2 decimal places', () => {
    expect(isValidDecimalAmount('45000.123')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidDecimalAmount('abc')).toBe(false);
    expect(isValidDecimalAmount('')).toBe(false);
  });
});

describe('isValidNonNegativeDecimalAmount', () => {
  it('accepts zero, unlike isValidDecimalAmount', () => {
    expect(isValidNonNegativeDecimalAmount('0')).toBe(true);
    expect(isValidNonNegativeDecimalAmount('0.00')).toBe(true);
  });

  it('accepts a positive value', () => {
    expect(isValidNonNegativeDecimalAmount('100.50')).toBe(true);
  });

  it('rejects negative values', () => {
    expect(isValidNonNegativeDecimalAmount('-1')).toBe(false);
  });
});

describe('isValidNonNegativeDecimalFraction (TASK-FIN-004 Stage F — Loan.interestRate, §13.20.3 NUMERIC(6,4))', () => {
  it('accepts a 4-decimal-place fraction (12% stored as the schema-documented decimal fraction)', () => {
    expect(isValidNonNegativeDecimalFraction('0.1200')).toBe(true);
  });

  it('accepts an arbitrary 4-decimal-place fraction not evenly representable at 2 decimals', () => {
    expect(isValidNonNegativeDecimalFraction('0.1235')).toBe(true);
  });

  it('accepts a 2-decimal-place fraction (e.g. 7.5% stored as "0.0750")', () => {
    expect(isValidNonNegativeDecimalFraction('0.0750')).toBe(true);
  });

  it('accepts zero (a genuine, explicit 0% rate, distinct from null/interest-free)', () => {
    expect(isValidNonNegativeDecimalFraction('0')).toBe(true);
    expect(isValidNonNegativeDecimalFraction('0.0000')).toBe(true);
  });

  it('accepts a whole-number fraction with no decimal part', () => {
    expect(isValidNonNegativeDecimalFraction('1')).toBe(true);
  });

  it('rejects negative values', () => {
    expect(isValidNonNegativeDecimalFraction('-0.12')).toBe(false);
  });

  it('rejects more than 4 decimal places (exceeds NUMERIC(6,4)’s own scale)', () => {
    expect(isValidNonNegativeDecimalFraction('0.12345')).toBe(false);
  });

  it('rejects more than 2 integer digits (exceeds NUMERIC(6,4)’s own precision)', () => {
    expect(isValidNonNegativeDecimalFraction('100.0000')).toBe(false);
  });

  it('does NOT reject "12.00" — it is a syntactically valid fraction (meaning 1200%, not a rejected shape); see compute-loan-amortization.spec.ts for proof this is never silently reinterpreted as 12%', () => {
    expect(isValidNonNegativeDecimalFraction('12.00')).toBe(true);
  });
});

describe('isValidPositiveDecimalRate (TASK-FIN-008 precision-bug fix — FxRate.rate, §13.8 Decimal(18,8))', () => {
  it('accepts a 2-decimal rate (the common case)', () => {
    expect(isValidPositiveDecimalRate('12500.75')).toBe(true);
  });

  it('accepts a full 8-decimal-place rate — the exact precision the 2-decimal money validator previously rejected', () => {
    expect(isValidPositiveDecimalRate('0.12345678')).toBe(true);
  });

  it('accepts a whole-number rate with no decimal part', () => {
    expect(isValidPositiveDecimalRate('12500')).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidPositiveDecimalRate('0')).toBe(false);
    expect(isValidPositiveDecimalRate('0.00000000')).toBe(false);
  });

  it('rejects a negative value', () => {
    expect(isValidPositiveDecimalRate('-5')).toBe(false);
  });

  it('rejects more than 8 decimal places (exceeds Decimal(18,8)’s own scale)', () => {
    expect(isValidPositiveDecimalRate('0.123456789')).toBe(false);
  });

  it('rejects a malformed value', () => {
    expect(isValidPositiveDecimalRate('abc')).toBe(false);
  });
});

describe('isValidSignedDecimalAmount (TASK-FIN-007 — Account.startingBalance)', () => {
  it('accepts a positive value', () => {
    expect(isValidSignedDecimalAmount('500000.00')).toBe(true);
  });

  it('accepts zero', () => {
    expect(isValidSignedDecimalAmount('0')).toBe(true);
  });

  it('accepts a negative value (a credit-card-style account owed a balance)', () => {
    expect(isValidSignedDecimalAmount('-150000.00')).toBe(true);
  });

  it('rejects more than 2 decimal places', () => {
    expect(isValidSignedDecimalAmount('-100.123')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidSignedDecimalAmount('abc')).toBe(false);
    expect(isValidSignedDecimalAmount('')).toBe(false);
    expect(isValidSignedDecimalAmount('--100')).toBe(false);
  });
});

describe('isValidCurrencyCode', () => {
  it('accepts a 3-letter uppercase code', () => {
    expect(isValidCurrencyCode('UZS')).toBe(true);
  });

  it('rejects lowercase, wrong length, or non-letter input', () => {
    expect(isValidCurrencyCode('uzs')).toBe(false);
    expect(isValidCurrencyCode('US')).toBe(false);
    expect(isValidCurrencyCode('123')).toBe(false);
  });
});

describe('isNonEmptyString', () => {
  it('rejects empty and whitespace-only strings', () => {
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('accepts a non-empty string', () => {
    expect(isNonEmptyString('Aziz')).toBe(true);
  });
});

describe('compareDecimalAmounts', () => {
  it('returns 0 for equal values with different formatting', () => {
    expect(compareDecimalAmounts('100', '100.00')).toBe(0);
  });

  it('returns -1 when the first value is smaller', () => {
    expect(compareDecimalAmounts('50', '100')).toBe(-1);
  });

  it('returns 1 when the first value is larger', () => {
    expect(compareDecimalAmounts('100.01', '100')).toBe(1);
  });

  it('is precision-safe for large values beyond JS float-safe range', () => {
    expect(compareDecimalAmounts('900000000000000001', '900000000000000000')).toBe(1);
  });
});

describe('subtractDecimalAmounts', () => {
  it('subtracts two whole-number amounts', () => {
    expect(subtractDecimalAmounts('100', '30')).toBe('70');
  });

  it('subtracts to exactly zero', () => {
    expect(subtractDecimalAmounts('50.00', '50')).toBe('0.00');
  });

  it('preserves decimal precision', () => {
    expect(subtractDecimalAmounts('100.50', '0.25')).toBe('100.25');
  });

  it('produces a negative result when a < b, never throwing (callers decide validity)', () => {
    expect(subtractDecimalAmounts('30', '100')).toBe('-70');
    expect(subtractDecimalAmounts('10.25', '10.50')).toBe('-0.25');
  });
});

describe('addDecimalAmounts (TASK-FIN-008)', () => {
  it('adds two whole-number amounts', () => {
    expect(addDecimalAmounts('100', '30')).toBe('130');
  });

  it('preserves decimal precision at the wider input scale', () => {
    expect(addDecimalAmounts('100.50', '0.25')).toBe('100.75');
  });

  it('reproduces getTotals()’s own accumulation shape (repeated addition against a running "0.00" total)', () => {
    let totalExpense = '0.00';
    for (const sum of ['15000.00', '2500.50', '99.99']) {
      totalExpense = addDecimalAmounts(totalExpense, sum);
    }
    expect(totalExpense).toBe('17600.49');
  });

  it('handles a negative operand', () => {
    expect(addDecimalAmounts('100.00', '-30.00')).toBe('70.00');
  });

  it('is precision-safe for large values beyond JS float-safe range', () => {
    expect(addDecimalAmounts('900000000000000001', '1')).toBe('900000000000000002');
  });
});

describe('percentOf (TASK-FIN-008, §8.14.4 budget_utilization / §8.14.5 goal_progress)', () => {
  it('reproduces AC-BUD-001’s own worked example: 200,000 / 1,500,000 ≈ 13.3%', () => {
    expect(percentOf('200000', '1500000')).toBeCloseTo(13.333333333333334, 10);
  });

  it('reproduces AC-FIN-004’s own worked example: 1,250,000 / 5,000,000 = exactly 25%', () => {
    expect(percentOf('1250000', '5000000')).toBe(25);
  });

  it('can exceed 100 when amount exceeds target (a budget/goal past its limit)', () => {
    expect(percentOf('150', '100')).toBe(150);
  });

  it('returns 0, never Infinity/NaN/a throw, for a non-positive target', () => {
    expect(percentOf('100', '0')).toBe(0);
    expect(percentOf('100', '-50')).toBe(0);
  });

  it('returns 0 for a non-finite target string, never NaN', () => {
    expect(percentOf('100', 'not-a-number')).toBe(0);
  });

  it('returns 0 for a zero amount against a valid target', () => {
    expect(percentOf('0', '1000')).toBe(0);
  });
});

describe('roundDecimalAmountToScale (TASK-FIN-008 — formatDecimalAmount’s HALF-UP fix basis)', () => {
  it('leaves an already-canonical 2-decimal value unchanged', () => {
    expect(roundDecimalAmountToScale('100.50', 2)).toBe('100.50');
  });

  it('pads a whole-number value with no fractional part up to the target scale', () => {
    expect(roundDecimalAmountToScale('100', 2)).toBe('100.00');
  });

  it('pads a value with fewer decimals than the target scale', () => {
    expect(roundDecimalAmountToScale('100.5', 2)).toBe('100.50');
  });

  it('rounds down (truncates) when the next digit is below half', () => {
    expect(roundDecimalAmountToScale('100.504', 2)).toBe('100.50');
    expect(roundDecimalAmountToScale('100.5049', 2)).toBe('100.50');
  });

  it('rounds up when the next digit is exactly half (HALF-UP, away from zero)', () => {
    expect(roundDecimalAmountToScale('100.505', 2)).toBe('100.51');
    expect(roundDecimalAmountToScale('100.50500', 2)).toBe('100.51');
  });

  it('rounds up when the next digit is above half', () => {
    expect(roundDecimalAmountToScale('100.506', 2)).toBe('100.51');
    expect(roundDecimalAmountToScale('100.509', 2)).toBe('100.51');
  });

  it('carries across the decimal boundary into the whole-number part', () => {
    expect(roundDecimalAmountToScale('1.995', 2)).toBe('2.00');
    expect(roundDecimalAmountToScale('99.999', 2)).toBe('100.00');
  });

  it('rounds HALF-UP (away from zero, not toward positive infinity) for negative values', () => {
    expect(roundDecimalAmountToScale('-100.505', 2)).toBe('-100.51');
    expect(roundDecimalAmountToScale('-1.995', 2)).toBe('-2.00');
    expect(roundDecimalAmountToScale('-100.504', 2)).toBe('-100.50');
  });

  it('handles a higher-scale NUMERIC value shaped like a cross-currency FX computation (Decimal(18,2) × Decimal(18,8))', () => {
    // The exact shape compute-account-balance.ts's/compute-savings-goal-progress.ts's
    // cross-currency SUM branch produces: amount * fx.rate.
    expect(roundDecimalAmountToScale('123.456789', 2)).toBe('123.46');
    expect(roundDecimalAmountToScale('10.567891234', 2)).toBe('10.57');
  });

  it('is precision-safe for large values beyond JS float-safe range', () => {
    expect(roundDecimalAmountToScale('900000000000000001.505', 2)).toBe('900000000000000001.51');
  });
});

describe('multiplyDecimalAmounts (TASK-FIN-004 Stage F — §8.14.6)', () => {
  it('multiplies two whole numbers', () => {
    expect(multiplyDecimalAmounts('500000', '12')).toBe('6000000');
  });

  it('multiplies at the combined scale, exactly (no rounding)', () => {
    expect(multiplyDecimalAmounts('500000.00', '12.00')).toBe('6000000.0000');
  });

  it('is precision-safe for large values beyond JS float-safe range', () => {
    expect(multiplyDecimalAmounts('900000000000000001', '2')).toBe('1800000000000000002');
  });

  it('handles a zero operand', () => {
    expect(multiplyDecimalAmounts('0', '12345.67')).toBe('0.00');
  });
});

describe('divideDecimalAmountByInteger (TASK-FIN-004 Stage F — §8.14.6)', () => {
  it('divides evenly with no rounding needed', () => {
    expect(divideDecimalAmountByInteger('6000000.0000', 12, 2)).toBe('500000.00');
  });

  it('rounds half-up (away from zero) at the target scale', () => {
    expect(divideDecimalAmountByInteger('10', 4, 2)).toBe('2.50');
    expect(divideDecimalAmountByInteger('1', 3, 2)).toBe('0.33');
    expect(divideDecimalAmountByInteger('2', 3, 2)).toBe('0.67');
  });

  it('rounds a genuine .5 tie up in magnitude', () => {
    // 0.125 at 2 decimal places is exactly a .5-of-the-last-digit tie.
    expect(divideDecimalAmountByInteger('0.125', 1, 2)).toBe('0.13');
  });

  it('throws for a non-positive or non-integer divisor', () => {
    expect(() => divideDecimalAmountByInteger('100', 0, 2)).toThrow(RangeError);
    expect(() => divideDecimalAmountByInteger('100', -1, 2)).toThrow(RangeError);
    expect(() => divideDecimalAmountByInteger('100', 1.5, 2)).toThrow(RangeError);
  });

  it('reproduces §8.14.6’s own worked shape: outstanding_balance × interest_rate / installments_per_year (decimal-fraction convention, §13.20.3)', () => {
    // 1,000,000 UZS outstanding, interest_rate stored as "0.1200" (12%
    // annual, the schema-documented decimal fraction — NOT "12.00"),
    // monthly installments (12/yr): interest due = 1,000,000 * 0.12 / 12 = 10,000.00
    const product = multiplyDecimalAmounts('1000000.00', '0.1200'); // scale 6
    const interestDue = divideDecimalAmountByInteger(product, 12, 2);
    expect(interestDue).toBe('10000.00');
  });
});

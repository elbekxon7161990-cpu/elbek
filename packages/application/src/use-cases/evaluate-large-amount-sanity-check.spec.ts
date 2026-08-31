import { describe, expect, it } from 'vitest';

import { evaluateLargeAmountSanityCheck } from './evaluate-large-amount-sanity-check';

describe('evaluateLargeAmountSanityCheck', () => {
  it('never flags when there is no historical average (null baseline)', () => {
    expect(evaluateLargeAmountSanityCheck('999999999', null)).toBe(false);
  });

  it('does not flag an amount exactly equal to 10x the average (must strictly exceed)', () => {
    expect(evaluateLargeAmountSanityCheck('50000', '5000')).toBe(false);
  });

  it('flags an amount greater than 10x the average', () => {
    expect(evaluateLargeAmountSanityCheck('50000.01', '5000')).toBe(true);
  });

  it('does not flag an amount less than 10x the average', () => {
    expect(evaluateLargeAmountSanityCheck('49999.99', '5000')).toBe(false);
  });

  it('compares exactly at decimal-precision boundaries without float error', () => {
    // 10 * 33333.33 = 333333.30 exactly — a float-based `10 * 33333.33`
    // computation is prone to producing 333333.29999999997 in JS.
    expect(evaluateLargeAmountSanityCheck('333333.30', '33333.33')).toBe(false);
    expect(evaluateLargeAmountSanityCheck('333333.31', '33333.33')).toBe(true);
  });

  it('handles operands with different decimal-place counts (e.g. a DB AVG() result)', () => {
    // average with 8 fractional digits (a plausible Postgres AVG() output),
    // amount with 0. 10 * 49999.99999999 = 499999.9999999 < 500000.
    expect(evaluateLargeAmountSanityCheck('500000', '49999.99999999')).toBe(true);
    // 10 * 50000.00000000 = 500000.00000000 == 500000 — not strictly exceeded.
    expect(evaluateLargeAmountSanityCheck('500000', '50000.00000000')).toBe(false);
  });

  it('respects a custom multiplier when explicitly provided', () => {
    expect(evaluateLargeAmountSanityCheck('15000', '5000', 3)).toBe(false);
    expect(evaluateLargeAmountSanityCheck('15000.01', '5000', 3)).toBe(true);
  });
});

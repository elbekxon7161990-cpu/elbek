import { describe, expect, it } from 'vitest';

import { convertPercentToDecimalFraction } from './convert-percent-to-decimal-fraction';

describe('convertPercentToDecimalFraction (TASK-FIN-004 Stage I)', () => {
  it('converts a whole-number percentage to the decimal-fraction convention', () => {
    expect(convertPercentToDecimalFraction('12')).toBe('0.1200');
  });

  it('converts a percentage with existing decimal places', () => {
    expect(convertPercentToDecimalFraction('12.35')).toBe('0.1235');
  });

  it('converts a small percentage', () => {
    expect(convertPercentToDecimalFraction('7.5')).toBe('0.0750');
  });

  it('converts an explicit zero percentage to "0.0000" (distinct from null/interest-free, per this stage’s own product decision)', () => {
    expect(convertPercentToDecimalFraction('0')).toBe('0.0000');
  });

  it('rounds a non-terminating conversion half-up to 4 decimal places', () => {
    // 1/3 % -> 0.00333...
    expect(convertPercentToDecimalFraction('0.3333333')).toBe('0.0033');
  });
});

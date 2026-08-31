import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { formatDecimalAmount } from './format-decimal-amount';

describe('formatDecimalAmount (TASK-FIN-008 — HALF-UP rounding fix, not truncation)', () => {
  it('returns "0.00" for null/undefined', () => {
    expect(formatDecimalAmount(null)).toBe('0.00');
    expect(formatDecimalAmount(undefined)).toBe('0.00');
  });

  it('leaves an already-canonical 2-decimal value unchanged', () => {
    expect(formatDecimalAmount('100.50')).toBe('100.50');
  });

  it('pads a Decimal(18,2) column read whose trailing zeros Prisma trimmed (the original reason this function exists)', () => {
    expect(formatDecimalAmount(new Prisma.Decimal('15000.00'))).toBe('15000.00');
  });

  it('rounds down when the next digit is below half', () => {
    expect(formatDecimalAmount('100.504')).toBe('100.50');
  });

  it('rounds up when the next digit is exactly half (HALF-UP, away from zero)', () => {
    expect(formatDecimalAmount('100.505')).toBe('100.51');
  });

  it('rounds up when the next digit is above half', () => {
    expect(formatDecimalAmount('100.509')).toBe('100.51');
  });

  it('carries across the decimal boundary into the whole-number part', () => {
    expect(formatDecimalAmount('99.999')).toBe('100.00');
  });

  it('rounds HALF-UP (away from zero) for a negative value', () => {
    expect(formatDecimalAmount('-100.505')).toBe('-100.51');
  });

  it('handles a higher-scale NUMERIC value shaped like a cross-currency FX computation (Decimal(18,2) × Decimal(18,8)) — the exact path this fix targets', () => {
    // compute-account-balance.ts's/compute-savings-goal-progress.ts's own
    // cross-currency SUM branch (`t.amount * fx.rate`) can produce a raw
    // ::text-cast Postgres NUMERIC result with more than 2 decimal places.
    expect(formatDecimalAmount('10.567891234')).toBe('10.57');
    expect(formatDecimalAmount(new Prisma.Decimal('10.567891234'))).toBe('10.57');
  });

  it('accepts a raw $queryRaw numeric string uniformly with a Decimal/plain string', () => {
    expect(formatDecimalAmount('7.5')).toBe('7.50');
  });
});

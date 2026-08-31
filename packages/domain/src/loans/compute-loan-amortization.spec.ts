import { describe, expect, it } from 'vitest';

import { computeLoanAmortization, installmentsPerYearFor } from './compute-loan-amortization';

describe('installmentsPerYearFor', () => {
  it('maps each PRD-permitted frequency to the standard convention', () => {
    expect(installmentsPerYearFor('weekly')).toBe(52);
    expect(installmentsPerYearFor('monthly')).toBe(12);
    expect(installmentsPerYearFor('quarterly')).toBe(4);
  });
});

describe('computeLoanAmortization (§8.14.6)', () => {
  it('interest-free: principal_portion equals the full payment amount (§8.14.6’s own explicit statement)', () => {
    const result = computeLoanAmortization({
      outstandingBalance: '1000000.00',
      interestRate: null,
      installmentsPerYear: 12,
      paymentAmount: '90000.00',
    });
    expect(result).toBe('90000.00');
  });

  it('interest-bearing: reproduces AC-FIN-003’s own worked numbers (1,000,000 UZS principal, 12% annual stored as the decimal fraction "0.1200", monthly)', () => {
    // interest due = 1,000,000 * 0.12 / 12 = 10,000.00
    const result = computeLoanAmortization({
      outstandingBalance: '1000000.00',
      interestRate: '0.1200',
      installmentsPerYear: 12,
      paymentAmount: '90000.00',
    });
    expect(result).toBe('80000.00'); // 90,000 - 10,000
  });

  it('interest-bearing: decreases as outstanding balance decreases (reducing-balance amortization)', () => {
    const result = computeLoanAmortization({
      outstandingBalance: '500000.00', // half the original balance
      interestRate: '0.1200',
      installmentsPerYear: 12,
      paymentAmount: '90000.00',
    });
    // interest due = 500,000 * 0.12 / 12 = 5,000.00
    expect(result).toBe('85000.00'); // 90,000 - 5,000
  });

  it('handles a weekly frequency (52 installments/year)', () => {
    // interest due = 1,000,000 * 0.0520 / 52 = 1,000.00
    const result = computeLoanAmortization({
      outstandingBalance: '1000000.00',
      interestRate: '0.0520',
      installmentsPerYear: 52,
      paymentAmount: '20000.00',
    });
    expect(result).toBe('19000.00');
  });

  it('returns a NEGATIVE principal_portion, unopinionated, when payment does not cover interest due (rejection is the caller’s job, not this pure function’s)', () => {
    // interest due = 1,000,000 * 0.12 / 12 = 10,000.00; payment of 5,000 doesn't cover it.
    const result = computeLoanAmortization({
      outstandingBalance: '1000000.00',
      interestRate: '0.1200',
      installmentsPerYear: 12,
      paymentAmount: '5000.00',
    });
    expect(result).toBe('-5000.00');
  });

  it('accepts a rate requiring the full 4-decimal-place precision NUMERIC(6,4) supports ("0.1235" = 12.35%) and computes correctly', () => {
    // interest due = 1,000,000 * 0.1235 / 12 = 10,291.666... -> rounds half-up to 10,291.67
    const result = computeLoanAmortization({
      outstandingBalance: '1000000.00',
      interestRate: '0.1235',
      installmentsPerYear: 12,
      paymentAmount: '90000.00',
    });
    expect(result).toBe('79708.33'); // 90,000 - 10,291.67
  });

  it('REGRESSION — "12.00" is NOT silently reinterpreted as 12%: passed as the raw decimal-fraction rate it means 1200% annual interest, producing a drastically different (and correctly negative) result than the old percentage convention would have', () => {
    // Under the removed percentage convention this would have computed
    // 80,000.00 (identical inputs to the AC-FIN-003 test above). Under the
    // corrected decimal-fraction convention, "12.00" as a fraction is
    // 1200% annual interest: interest due = 1,000,000 * 12 / 12 = 1,000,000.00
    // — the entire outstanding balance in a single period — proving there
    // is no hidden /100 step left anywhere in this formula.
    const result = computeLoanAmortization({
      outstandingBalance: '1000000.00',
      interestRate: '12.00',
      installmentsPerYear: 12,
      paymentAmount: '90000.00',
    });
    expect(result).toBe('-910000.00'); // 90,000 - 1,000,000
    expect(result).not.toBe('80000.00');
  });

  it('returns a principal_portion EXCEEDING outstandingBalance, unopinionated, for a large payment (overpayment rejection is the caller’s job)', () => {
    const result = computeLoanAmortization({
      outstandingBalance: '10000.00',
      interestRate: null,
      installmentsPerYear: 12,
      paymentAmount: '50000.00',
    });
    expect(result).toBe('50000.00');
  });

  it('rounds a non-terminating interest-due figure half-up to 2 decimal places', () => {
    // interest due = 100,000 * 0.0700 / 52 = 134.615384... -> rounds to 134.62
    const result = computeLoanAmortization({
      outstandingBalance: '100000.00',
      interestRate: '0.0700',
      installmentsPerYear: 52,
      paymentAmount: '1000.00',
    });
    expect(result).toBe('865.38'); // 1000.00 - 134.62
  });
});

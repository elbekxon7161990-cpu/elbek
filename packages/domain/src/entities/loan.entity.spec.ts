import { describe, expect, it } from 'vitest';

import { Loan, type LoanProps, type NewLoanValidationProps } from './loan.entity';
import { InvalidLoanError } from '../errors/invalid-loan.error';
import { LoanOverpaymentError } from '../errors/loan-overpayment.error';
import { NegativeAmortizationError } from '../errors/negative-amortization.error';

const FIXED_NOW = new Date('2026-08-17T12:00:00Z');

function makeProps(overrides: Partial<LoanProps> = {}): LoanProps {
  return {
    id: 'loan-1',
    userId: 'user-1',
    lender: 'Ipoteka Bank',
    principalAmount: '1000000.00',
    outstandingBalance: '1000000.00',
    currency: 'UZS',
    interestRate: '0.1200',
    installmentAmount: '90000.00',
    installmentFrequency: 'monthly',
    startDate: new Date('2026-08-01'),
    status: 'open',
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeNewProps(overrides: Partial<NewLoanValidationProps> = {}): NewLoanValidationProps {
  return {
    userId: 'user-1',
    lender: 'Ipoteka Bank',
    principalAmount: '1000000.00',
    currency: 'UZS',
    interestRate: '0.1200',
    installmentAmount: '90000.00',
    installmentFrequency: 'monthly',
    startDate: new Date('2026-08-01'),
    ...overrides,
  };
}

describe('Loan', () => {
  it('creates a valid interest-bearing loan (FR-FIN-007)', () => {
    const loan = new Loan(makeProps());

    expect(loan.lender).toBe('Ipoteka Bank');
    expect(loan.status).toBe('open');
    expect(loan.interestRate).toBe('0.1200');
  });

  it('creates a valid interest-free loan — null interestRate is explicitly valid (FR-FIN-007)', () => {
    const loan = new Loan(makeProps({ interestRate: null }));

    expect(loan.interestRate).toBeNull();
  });

  it('rejects a negative interestRate', () => {
    expect(() => new Loan(makeProps({ interestRate: '-1' }))).toThrow(InvalidLoanError);
  });

  it('rejects a non-positive principalAmount', () => {
    expect(() => new Loan(makeProps({ principalAmount: '0' }))).toThrow(InvalidLoanError);
    expect(() => new Loan(makeProps({ principalAmount: '-100' }))).toThrow(InvalidLoanError);
  });

  it('rejects a negative outstandingBalance', () => {
    expect(() => new Loan(makeProps({ outstandingBalance: '-1' }))).toThrow(InvalidLoanError);
  });

  it('rejects outstandingBalance exceeding principalAmount', () => {
    expect(
      () => new Loan(makeProps({ principalAmount: '100000.00', outstandingBalance: '150000.00' })),
    ).toThrow(InvalidLoanError);
  });

  it('rejects an invalid installmentFrequency', () => {
    expect(() => new Loan(makeProps({ installmentFrequency: 'daily' as never }))).toThrow(
      InvalidLoanError,
    );
  });

  it.each(['weekly', 'monthly', 'quarterly'] as const)(
    'accepts installmentFrequency "%s"',
    (installmentFrequency) => {
      expect(() => new Loan(makeProps({ installmentFrequency }))).not.toThrow();
    },
  );

  it('rejects a non-positive installmentAmount', () => {
    expect(() => new Loan(makeProps({ installmentAmount: '0' }))).toThrow(InvalidLoanError);
  });

  it('rejects an invalid currency code', () => {
    expect(() => new Loan(makeProps({ currency: 'us' }))).toThrow(InvalidLoanError);
  });

  it('rejects an invalid status', () => {
    expect(() => new Loan(makeProps({ status: 'defaulted' as never }))).toThrow(InvalidLoanError);
  });

  it('rejects a "paid_off" loan with a non-zero outstandingBalance', () => {
    expect(() => new Loan(makeProps({ status: 'paid_off', outstandingBalance: '500.00' }))).toThrow(
      InvalidLoanError,
    );
  });

  it('accepts a "paid_off" loan with a zero outstandingBalance', () => {
    expect(
      () => new Loan(makeProps({ status: 'paid_off', outstandingBalance: '0.00' })),
    ).not.toThrow();
  });

  it('rejects an "open" loan with a zero outstandingBalance', () => {
    expect(() => new Loan(makeProps({ status: 'open', outstandingBalance: '0.00' }))).toThrow(
      InvalidLoanError,
    );
  });

  it('rejects a missing lender', () => {
    expect(() => new Loan(makeProps({ lender: '' }))).toThrow(InvalidLoanError);
  });

  describe('validateNew', () => {
    it('validates a well-formed new loan without throwing', () => {
      expect(() => Loan.validateNew(makeNewProps(), FIXED_NOW)).not.toThrow();
    });

    it('rejects a new loan with an invalid principalAmount', () => {
      expect(() => Loan.validateNew(makeNewProps({ principalAmount: '0' }), FIXED_NOW)).toThrow(
        InvalidLoanError,
      );
    });

    it('defaults a new loan to status "open" with outstandingBalance === principalAmount (mirrors Debt precedent)', () => {
      // validateNew has no return value (mirrors Debt.validateNew) — this is
      // implicitly exercised by the "does not throw" case above; the
      // open+fully-outstanding starting state is asserted directly via the
      // constructor invariants (status<->balance consistency tests above).
      expect(() => Loan.validateNew(makeNewProps(), FIXED_NOW)).not.toThrow();
    });
  });

  it('isDeleted reflects deletedAt', () => {
    expect(new Loan(makeProps()).isDeleted).toBe(false);
    expect(new Loan(makeProps({ deletedAt: FIXED_NOW })).isDeleted).toBe(true);
  });

  describe('applyPayment (TASK-FIN-004 Stage F, §8.14.6, AC-FIN-003)', () => {
    it('A — interest-free: principal_portion equals the full payment, balance decreases by exactly that amount', () => {
      const loan = new Loan(
        makeProps({
          interestRate: null,
          principalAmount: '1000000.00',
          outstandingBalance: '1000000.00',
        }),
      );

      const { loan: updated, principalPortion } = loan.applyPayment('90000.00', FIXED_NOW);

      expect(principalPortion).toBe('90000.00');
      expect(updated.outstandingBalance).toBe('910000.00');
      expect(updated.status).toBe('open');
    });

    it('B — interest-bearing: reduces principal by less than the full payment (AC-FIN-003’s own explicit requirement)', () => {
      const loan = new Loan(
        makeProps({
          interestRate: '0.1200',
          principalAmount: '1000000.00',
          outstandingBalance: '1000000.00',
          installmentFrequency: 'monthly',
        }),
      );

      const { principalPortion } = loan.applyPayment('90000.00', FIXED_NOW);

      // interest due = 1,000,000 * 0.12 / 12 = 10,000.00
      expect(principalPortion).toBe('80000.00');
    });

    it('C — PARTIAL/IRREGULAR PAYMENTS = ALLOWED: a payment far below installmentAmount is accepted, never required to match it', () => {
      const loan = new Loan(
        makeProps({
          interestRate: null,
          installmentAmount: '90000.00',
          outstandingBalance: '1000000.00',
        }),
      );

      expect(() => loan.applyPayment('500.00', FIXED_NOW)).not.toThrow();
    });

    it('D — PARTIAL/IRREGULAR PAYMENTS = ALLOWED: a payment far above installmentAmount is accepted (as long as it does not overpay)', () => {
      const loan = new Loan(
        makeProps({
          interestRate: null,
          installmentAmount: '90000.00',
          outstandingBalance: '1000000.00',
        }),
      );

      expect(() => loan.applyPayment('999999.99', FIXED_NOW)).not.toThrow();
    });

    it('E — OVERPAYMENT = REJECT: a payment whose principal_portion exceeds outstandingBalance is rejected outright, never clamped', () => {
      const loan = new Loan(makeProps({ interestRate: null, outstandingBalance: '50000.00' }));

      expect(() => loan.applyPayment('50000.01', FIXED_NOW)).toThrow(LoanOverpaymentError);
    });

    it('F — a payment exactly equal to outstandingBalance is accepted and reaches exactly zero (the boundary, not overpayment)', () => {
      const loan = new Loan(makeProps({ interestRate: null, outstandingBalance: '50000.00' }));

      const { loan: updated, principalPortion } = loan.applyPayment('50000.00', FIXED_NOW);

      expect(principalPortion).toBe('50000.00');
      expect(updated.outstandingBalance).toBe('0.00');
    });

    it('G — reaching exactly zero transitions status to "paid_off" (preserves the existing outstandingBalance==0 <-> paid_off invariant)', () => {
      const loan = new Loan(makeProps({ interestRate: null, outstandingBalance: '50000.00' }));

      const { loan: updated } = loan.applyPayment('50000.00', FIXED_NOW);

      expect(updated.status).toBe('paid_off');
    });

    it('H — NEGATIVE AMORTIZATION = REJECT: a payment smaller than the interest due is rejected outright, never clamped to zero, never increases outstandingBalance', () => {
      const loan = new Loan(
        makeProps({
          interestRate: '0.1200',
          outstandingBalance: '1000000.00',
          installmentFrequency: 'monthly',
        }),
      );
      // interest due = 1,000,000 * 0.12 / 12 = 10,000.00; 5,000 doesn't cover it.

      expect(() => loan.applyPayment('5000.00', FIXED_NOW)).toThrow(NegativeAmortizationError);
    });

    it('I — a payment exactly equal to the interest due (principal_portion === 0) is ACCEPTED, not rejected (0 is not "negative")', () => {
      const loan = new Loan(
        makeProps({
          interestRate: '0.1200',
          outstandingBalance: '1000000.00',
          installmentFrequency: 'monthly',
        }),
      );

      const { principalPortion, loan: updated } = loan.applyPayment('10000.00', FIXED_NOW);

      expect(principalPortion).toBe('0.00');
      expect(updated.outstandingBalance).toBe('1000000.00');
      expect(updated.status).toBe('open');
    });

    it('J — rejects applying a payment to a loan that is not open', () => {
      const loan = new Loan(
        makeProps({ interestRate: null, outstandingBalance: '0.00', status: 'paid_off' }),
      );

      expect(() => loan.applyPayment('100.00', FIXED_NOW)).toThrow(InvalidLoanError);
    });

    it('K — rejects an invalid (non-positive) payment amount', () => {
      const loan = new Loan(makeProps({ interestRate: null, outstandingBalance: '50000.00' }));

      expect(() => loan.applyPayment('-100', FIXED_NOW)).toThrow(InvalidLoanError);
      expect(() => loan.applyPayment('0', FIXED_NOW)).toThrow(InvalidLoanError);
    });

    it('L — reducing-balance amortization: the same nominal payment yields a LARGER principal_portion as outstandingBalance shrinks', () => {
      const highBalanceLoan = new Loan(
        makeProps({
          interestRate: '0.1200',
          outstandingBalance: '1000000.00',
          installmentFrequency: 'monthly',
        }),
      );
      const lowBalanceLoan = new Loan(
        makeProps({
          interestRate: '0.1200',
          outstandingBalance: '100000.00',
          installmentFrequency: 'monthly',
        }),
      );

      const highResult = highBalanceLoan.applyPayment('90000.00', FIXED_NOW);
      const lowResult = lowBalanceLoan.applyPayment('90000.00', FIXED_NOW);

      // high balance: interest = 10,000 -> principal_portion = 80,000
      // low balance: interest = 1,000 -> principal_portion = 89,000
      expect(highResult.principalPortion).toBe('80000.00');
      expect(lowResult.principalPortion).toBe('89000.00');
    });

    it('M — accepts the full NUMERIC(6,4) precision a stored interestRate can carry (12.35% as "0.1235") and computes correctly', () => {
      const loan = new Loan(
        makeProps({
          interestRate: '0.1235',
          outstandingBalance: '1000000.00',
          installmentFrequency: 'monthly',
        }),
      );

      // interest due = 1,000,000 * 0.1235 / 12 = 10,291.666... -> 10,291.67
      const { principalPortion } = loan.applyPayment('90000.00', FIXED_NOW);

      expect(principalPortion).toBe('79708.33'); // 90,000 - 10,291.67
    });

    it('N — REGRESSION: "12.00" is NOT silently reinterpreted as 12% — as a raw decimal fraction it is 1200% annual interest, so a normal installment payment is rejected as negative amortization instead of succeeding as it would have under the old (removed) percentage convention', () => {
      const loan = new Loan(
        makeProps({
          interestRate: '12.00',
          outstandingBalance: '1000000.00',
          installmentFrequency: 'monthly',
        }),
      );

      // interest due = 1,000,000 * 12 / 12 = 1,000,000.00 — a normal 90,000
      // installment cannot possibly cover it, unlike under the old
      // percentage convention where this exact setup produced a successful
      // 80,000.00 principal_portion (see test B above).
      expect(() => loan.applyPayment('90000.00', FIXED_NOW)).toThrow(NegativeAmortizationError);
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  LoanPayment,
  type LoanPaymentProps,
  type NewLoanPaymentValidationProps,
} from './loan-payment.entity';
import { InvalidLoanError } from '../errors/invalid-loan.error';

const FIXED_NOW = new Date('2026-08-18T12:00:00Z');

function makeProps(overrides: Partial<LoanPaymentProps> = {}): LoanPaymentProps {
  return {
    id: 'payment-1',
    loanId: 'loan-1',
    amount: '90000.00',
    principalPortion: '80000.00',
    paymentDate: new Date('2026-08-15'),
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeNewProps(
  overrides: Partial<NewLoanPaymentValidationProps> = {},
): NewLoanPaymentValidationProps {
  return {
    loanId: 'loan-1',
    amount: '90000.00',
    principalPortion: '80000.00',
    paymentDate: new Date('2026-08-15'),
    ...overrides,
  };
}

describe('LoanPayment', () => {
  it('creates a valid payment', () => {
    const payment = new LoanPayment(makeProps());
    expect(payment.amount).toBe('90000.00');
    expect(payment.principalPortion).toBe('80000.00');
    expect(payment.loanId).toBe('loan-1');
  });

  it('rejects a zero or negative amount (CHECK amount > 0, §13.20.3)', () => {
    expect(() => new LoanPayment(makeProps({ amount: '0' }))).toThrow(InvalidLoanError);
    expect(() => new LoanPayment(makeProps({ amount: '-100' }))).toThrow(InvalidLoanError);
  });

  it('accepts a principalPortion of exactly zero (an interest-only payment — not rejected by the NEGATIVE AMORTIZATION decision, which only rejects a value BELOW zero)', () => {
    expect(() => new LoanPayment(makeProps({ principalPortion: '0.00' }))).not.toThrow();
  });

  it('rejects a missing loanId', () => {
    expect(() => new LoanPayment(makeProps({ loanId: '' }))).toThrow(InvalidLoanError);
  });

  it('rejects a malformed principalPortion', () => {
    expect(() => new LoanPayment(makeProps({ principalPortion: 'not-a-number' }))).toThrow(
      InvalidLoanError,
    );
  });

  it('rejects an invalid paymentDate', () => {
    expect(() => new LoanPayment(makeProps({ paymentDate: new Date('invalid') }))).toThrow(
      InvalidLoanError,
    );
  });

  describe('validateNew', () => {
    it('accepts a valid not-yet-persisted payment', () => {
      expect(() => LoanPayment.validateNew(makeNewProps(), FIXED_NOW)).not.toThrow();
    });

    it('rejects an invalid amount before any persistence', () => {
      expect(() => LoanPayment.validateNew(makeNewProps({ amount: '0' }), FIXED_NOW)).toThrow(
        InvalidLoanError,
      );
    });
  });
});

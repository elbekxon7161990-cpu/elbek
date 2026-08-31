import { describe, expect, it } from 'vitest';

import {
  DebtRepayment,
  type DebtRepaymentProps,
  type NewDebtRepaymentValidationProps,
} from './debt-repayment.entity';
import { InvalidDebtError } from '../errors/invalid-debt.error';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeProps(overrides: Partial<DebtRepaymentProps> = {}): DebtRepaymentProps {
  return {
    id: 'repayment-1',
    debtId: 'debt-1',
    amount: '20000',
    currency: 'UZS',
    repaymentDate: new Date('2026-08-10'),
    originalText: 'paid back 20000',
    deletedAt: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeNewProps(
  overrides: Partial<NewDebtRepaymentValidationProps> = {},
): NewDebtRepaymentValidationProps {
  return {
    debtId: 'debt-1',
    amount: '20000',
    currency: 'UZS',
    repaymentDate: new Date('2026-08-10'),
    originalText: 'paid back 20000',
    ...overrides,
  };
}

describe('DebtRepayment', () => {
  it('creates a valid repayment', () => {
    const repayment = new DebtRepayment(makeProps());
    expect(repayment.amount).toBe('20000');
    expect(repayment.debtId).toBe('debt-1');
  });

  it('rejects a zero or negative amount (CHECK amount > 0)', () => {
    expect(() => new DebtRepayment(makeProps({ amount: '0' }))).toThrow(InvalidDebtError);
    expect(() => new DebtRepayment(makeProps({ amount: '-100' }))).toThrow(InvalidDebtError);
  });

  it('rejects an invalid currency code', () => {
    expect(() => new DebtRepayment(makeProps({ currency: 'usd' }))).toThrow(InvalidDebtError);
  });

  it('rejects a missing debtId', () => {
    expect(() => new DebtRepayment(makeProps({ debtId: '' }))).toThrow(InvalidDebtError);
  });

  it('rejects a missing originalText', () => {
    expect(() => new DebtRepayment(makeProps({ originalText: '' }))).toThrow(InvalidDebtError);
  });

  describe('validateNew', () => {
    it('accepts a valid not-yet-persisted repayment', () => {
      expect(() => DebtRepayment.validateNew(makeNewProps(), FIXED_NOW)).not.toThrow();
    });

    it('rejects an invalid amount before any persistence', () => {
      expect(() => DebtRepayment.validateNew(makeNewProps({ amount: '0' }), FIXED_NOW)).toThrow(
        InvalidDebtError,
      );
    });
  });
});

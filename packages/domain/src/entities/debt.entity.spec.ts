import { describe, expect, it } from 'vitest';

import { Debt, type DebtProps, type NewDebtValidationProps } from './debt.entity';
import { DebtOverpaymentError } from '../errors/debt-overpayment.error';
import { InvalidDebtError } from '../errors/invalid-debt.error';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeProps(overrides: Partial<DebtProps> = {}): DebtProps {
  return {
    id: 'debt-1',
    userId: 'user-1',
    direction: 'given',
    counterpartyName: 'Aziz',
    counterpartyRefId: 'counterparty-1',
    originalAmount: '100000',
    outstandingBalance: '100000',
    currency: 'UZS',
    transactionDate: new Date('2026-08-01'),
    dueDate: new Date('2026-09-01'),
    status: 'open',
    notes: null,
    originalText: 'lent 100000 to Aziz',
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeNewProps(overrides: Partial<NewDebtValidationProps> = {}): NewDebtValidationProps {
  return {
    userId: 'user-1',
    direction: 'given',
    counterpartyName: 'Aziz',
    counterpartyRefId: null,
    originalAmount: '100000',
    currency: 'UZS',
    transactionDate: new Date('2026-08-01'),
    dueDate: new Date('2026-09-01'),
    notes: null,
    originalText: 'lent 100000 to Aziz',
    ...overrides,
  };
}

describe('Debt', () => {
  it('creates a valid DEBT_GIVEN debt (FR-DBT-001)', () => {
    const debt = new Debt(makeProps({ direction: 'given' }));
    expect(debt.direction).toBe('given');
    expect(debt.status).toBe('open');
  });

  it('creates a valid DEBT_RECEIVED debt (FR-DBT-001)', () => {
    const debt = new Debt(makeProps({ direction: 'received' }));
    expect(debt.direction).toBe('received');
  });

  it('rejects an invalid direction', () => {
    expect(() => new Debt(makeProps({ direction: 'sideways' as never }))).toThrow(InvalidDebtError);
  });

  it('rejects a zero or negative originalAmount', () => {
    expect(() => new Debt(makeProps({ originalAmount: '0' }))).toThrow(InvalidDebtError);
    expect(() => new Debt(makeProps({ originalAmount: '-500' }))).toThrow(InvalidDebtError);
  });

  it('rejects an invalid currency code', () => {
    expect(() => new Debt(makeProps({ currency: 'usd' }))).toThrow(InvalidDebtError);
  });

  it('rejects a missing counterpartyName (BR-DBT-002)', () => {
    expect(() => new Debt(makeProps({ counterpartyName: '' }))).toThrow(InvalidDebtError);
  });

  it('rejects a negative outstandingBalance (BR-DBT-001)', () => {
    expect(() => new Debt(makeProps({ outstandingBalance: '-1', status: 'open' }))).toThrow(
      InvalidDebtError,
    );
  });

  it('rejects an outstandingBalance greater than originalAmount', () => {
    expect(
      () => new Debt(makeProps({ originalAmount: '100000', outstandingBalance: '150000' })),
    ).toThrow(InvalidDebtError);
  });

  it('rejects a "repaid" debt with a non-zero outstandingBalance', () => {
    expect(() => new Debt(makeProps({ status: 'repaid', outstandingBalance: '5000' }))).toThrow(
      InvalidDebtError,
    );
  });

  it('rejects an "open" debt with a zero outstandingBalance', () => {
    expect(() => new Debt(makeProps({ status: 'open', outstandingBalance: '0' }))).toThrow(
      InvalidDebtError,
    );
  });

  it('accepts a "repaid" debt with a zero outstandingBalance', () => {
    const debt = new Debt(makeProps({ status: 'repaid', outstandingBalance: '0' }));
    expect(debt.status).toBe('repaid');
  });

  it('accepts a "forgiven" debt regardless of outstandingBalance (FR-DBT-005)', () => {
    const debt = new Debt(
      makeProps({ status: 'forgiven', outstandingBalance: '50000', originalAmount: '100000' }),
    );
    expect(debt.status).toBe('forgiven');
  });

  it('carries a user id that scopes ownership (user isolation depends on this field being preserved exactly — the actual cross-user isolation guarantee is enforced by RLS at the repository layer and by an explicit ownership check in SettleDebtUseCase, both tested at their own layers)', () => {
    const debt = new Debt(makeProps({ userId: 'user-42' }));
    expect(debt.userId).toBe('user-42');
  });

  describe('reconstruction from persistence never re-validates the due date against "now"', () => {
    it('accepts reading back an OPEN debt whose due date has already passed (an overdue debt is a normal, expected state)', () => {
      const overdueDebt = new Debt(
        makeProps({
          dueDate: new Date('2020-01-01'), // long in the past relative to any "now"
          status: 'open',
        }),
      );
      expect(overdueDebt.dueDate).toEqual(new Date('2020-01-01'));
    });
  });

  describe('validateNew (§8.3.6 — a due date already in the past at creation is rejected)', () => {
    it('accepts a valid new debt with a future due date', () => {
      expect(() =>
        Debt.validateNew(makeNewProps({ dueDate: new Date('2026-09-01') }), FIXED_NOW),
      ).not.toThrow();
    });

    it('accepts a new debt with no due date at all', () => {
      expect(() => Debt.validateNew(makeNewProps({ dueDate: null }), FIXED_NOW)).not.toThrow();
    });

    it('rejects a due date already in the past at creation time', () => {
      expect(() =>
        Debt.validateNew(makeNewProps({ dueDate: new Date('2020-01-01') }), FIXED_NOW),
      ).toThrow(InvalidDebtError);
    });

    it('rejects the same other invariants the constructor enforces (e.g. invalid amount)', () => {
      expect(() => Debt.validateNew(makeNewProps({ originalAmount: '0' }), FIXED_NOW)).toThrow(
        InvalidDebtError,
      );
    });
  });

  describe('applyRepayment (outstanding balance arithmetic, BR-DBT-001)', () => {
    it('computes the correct outstanding balance for a partial repayment', () => {
      const debt = new Debt(makeProps({ originalAmount: '100000', outstandingBalance: '100000' }));
      const updated = debt.applyRepayment('30000', FIXED_NOW);
      expect(updated.outstandingBalance).toBe('70000');
      expect(updated.status).toBe('open');
    });

    it('closes the debt (status -> repaid) on an exact full repayment', () => {
      const debt = new Debt(makeProps({ originalAmount: '100000', outstandingBalance: '40000' }));
      const updated = debt.applyRepayment('40000', FIXED_NOW);
      expect(updated.outstandingBalance).toBe('0');
      expect(updated.status).toBe('repaid');
    });

    it('closes the debt via a sequence of partial repayments summing to the full amount', () => {
      const debt = new Debt(makeProps({ originalAmount: '100000', outstandingBalance: '100000' }));
      const afterFirst = debt.applyRepayment('60000', FIXED_NOW);
      expect(afterFirst.outstandingBalance).toBe('40000');
      expect(afterFirst.status).toBe('open');

      const afterSecond = afterFirst.applyRepayment('40000', FIXED_NOW);
      expect(afterSecond.outstandingBalance).toBe('0');
      expect(afterSecond.status).toBe('repaid');
    });

    it('rejects (throws DebtOverpaymentError) a repayment larger than the outstanding balance, never silently applying it', () => {
      const debt = new Debt(makeProps({ originalAmount: '100000', outstandingBalance: '40000' }));
      expect(() => debt.applyRepayment('50000', FIXED_NOW)).toThrow(DebtOverpaymentError);
      // The debt itself is unchanged — applyRepayment returns a new
      // instance only on success; a caller that discards the thrown
      // attempt is left with the original, still-open, still-40000 debt.
      expect(debt.outstandingBalance).toBe('40000');
    });

    it('rejects a zero or negative repayment amount', () => {
      const debt = new Debt(makeProps({ outstandingBalance: '40000' }));
      expect(() => debt.applyRepayment('0', FIXED_NOW)).toThrow(InvalidDebtError);
      expect(() => debt.applyRepayment('-100', FIXED_NOW)).toThrow(InvalidDebtError);
    });

    it('rejects applying a repayment to a non-open debt', () => {
      const repaidDebt = new Debt(makeProps({ status: 'repaid', outstandingBalance: '0' }));
      expect(() => repaidDebt.applyRepayment('100', FIXED_NOW)).toThrow(InvalidDebtError);

      const forgivenDebt = new Debt(makeProps({ status: 'forgiven' }));
      expect(() => forgivenDebt.applyRepayment('100', FIXED_NOW)).toThrow(InvalidDebtError);
    });
  });

  describe('forgive (FR-DBT-005)', () => {
    it('transitions an open debt to "forgiven"', () => {
      const debt = new Debt(makeProps({ status: 'open', outstandingBalance: '40000' }));
      const forgiven = debt.forgive(FIXED_NOW);
      expect(forgiven.status).toBe('forgiven');
      // The remaining balance is written off, not paid down — distinct
      // from 'repaid', which always implies a zero balance.
      expect(forgiven.outstandingBalance).toBe('40000');
    });

    it('rejects forgiving an already-repaid or already-forgiven debt', () => {
      const repaidDebt = new Debt(makeProps({ status: 'repaid', outstandingBalance: '0' }));
      expect(() => repaidDebt.forgive(FIXED_NOW)).toThrow(InvalidDebtError);

      const forgivenDebt = new Debt(makeProps({ status: 'forgiven' }));
      expect(() => forgivenDebt.forgive(FIXED_NOW)).toThrow(InvalidDebtError);
    });
  });
});

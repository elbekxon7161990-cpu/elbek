import { describe, expect, it } from 'vitest';

import { Budget } from './budget.entity';
import { InvalidBudgetError } from '../errors/invalid-budget.error';

function validNewCategoryProps() {
  return {
    userId: 'user-1',
    scopeType: 'category' as const,
    categoryId: 'category-1',
    limitAmount: '1500000.00',
    currency: 'UZS',
    periodType: 'monthly' as const,
    currentPeriodStart: new Date('2026-08-01'),
    currentPeriodEnd: new Date('2026-08-31'),
  };
}

function validCategoryProps() {
  return {
    id: 'budget-1',
    ...validNewCategoryProps(),
    status: 'active' as const,
    deletedAt: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };
}

describe('Budget', () => {
  it('constructs successfully with valid category-scope props', () => {
    const budget = new Budget(validCategoryProps());
    expect(budget.id).toBe('budget-1');
    expect(budget.isDeleted).toBe(false);
  });

  it('constructs successfully with valid overall-scope props (categoryId null)', () => {
    const budget = new Budget({ ...validCategoryProps(), scopeType: 'overall', categoryId: null });
    expect(budget.scopeType).toBe('overall');
    expect(budget.categoryId).toBeNull();
  });

  it('rejects an overall-scope budget that references a category (chk_budgets_scope_category)', () => {
    expect(
      () => new Budget({ ...validCategoryProps(), scopeType: 'overall', categoryId: 'category-1' }),
    ).toThrow(InvalidBudgetError);
  });

  it('rejects a category-scope budget with no category', () => {
    expect(() => new Budget({ ...validCategoryProps(), categoryId: null })).toThrow(
      InvalidBudgetError,
    );
  });

  it('rejects a zero or negative limitAmount', () => {
    expect(() => new Budget({ ...validCategoryProps(), limitAmount: '0' })).toThrow(
      InvalidBudgetError,
    );
    expect(() => new Budget({ ...validCategoryProps(), limitAmount: '-5' })).toThrow(
      InvalidBudgetError,
    );
  });

  it('rejects an invalid periodType', () => {
    expect(() => new Budget({ ...validCategoryProps(), periodType: 'daily' as never })).toThrow(
      InvalidBudgetError,
    );
  });

  it('rejects an invalid currency code', () => {
    expect(() => new Budget({ ...validCategoryProps(), currency: 'usd' })).toThrow(
      InvalidBudgetError,
    );
  });

  it('rejects currentPeriodEnd before currentPeriodStart', () => {
    expect(
      () =>
        new Budget({
          ...validCategoryProps(),
          currentPeriodStart: new Date('2026-08-31'),
          currentPeriodEnd: new Date('2026-08-01'),
        }),
    ).toThrow(InvalidBudgetError);
  });

  describe('validateNew', () => {
    it('accepts a valid not-yet-persisted budget', () => {
      expect(() => Budget.validateNew(validNewCategoryProps())).not.toThrow();
    });

    it('rejects an invalid not-yet-persisted budget the same way the constructor would', () => {
      expect(() => Budget.validateNew({ ...validNewCategoryProps(), limitAmount: '0' })).toThrow(
        InvalidBudgetError,
      );
    });
  });
});

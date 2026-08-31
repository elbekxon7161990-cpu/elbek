import type { Budget, BudgetRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetNotFoundError } from '../errors/budget-not-found.error';
import { UnauthorizedBudgetAccessError } from '../errors/unauthorized-budget-access.error';
import { DeleteBudgetUseCase } from './delete-budget.use-case';

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    userId: 'user-1',
    scopeType: 'category',
    categoryId: 'category-1',
    limitAmount: '1500000',
    currency: 'UZS',
    periodType: 'monthly',
    currentPeriodStart: new Date('2026-08-01'),
    currentPeriodEnd: new Date('2026-08-31'),
    status: 'active',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    ...overrides,
  } as Budget;
}

describe('DeleteBudgetUseCase', () => {
  let budgetRepository: {
    findById: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  let useCase: DeleteBudgetUseCase;

  beforeEach(() => {
    budgetRepository = {
      findById: vi.fn().mockResolvedValue(makeBudget()),
      softDelete: vi
        .fn()
        .mockImplementation(() => Promise.resolve(makeBudget({ deletedAt: new Date() }))),
    };

    useCase = new DeleteBudgetUseCase(budgetRepository as unknown as BudgetRepository);
  });

  it('soft-deletes the budget (FR-BUD-007)', async () => {
    const result = await useCase.execute({ userId: 'user-1', budgetId: 'budget-1' });

    expect(budgetRepository.softDelete).toHaveBeenCalledWith('budget-1', 'user-1');
    expect(result.deletedAt).not.toBeNull();
  });

  it('throws BudgetNotFoundError when the budget does not exist', async () => {
    budgetRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'user-1', budgetId: 'missing' })).rejects.toThrow(
      BudgetNotFoundError,
    );
    expect(budgetRepository.softDelete).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedBudgetAccessError when the budget belongs to a different user', async () => {
    budgetRepository.findById.mockResolvedValue(makeBudget({ userId: 'other-user' }));

    await expect(useCase.execute({ userId: 'user-1', budgetId: 'budget-1' })).rejects.toThrow(
      UnauthorizedBudgetAccessError,
    );
    expect(budgetRepository.softDelete).not.toHaveBeenCalled();
  });

  it("throws BudgetNotFoundError when the repository's own atomic delete matches zero rows (already deleted by a concurrent call)", async () => {
    budgetRepository.softDelete.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'user-1', budgetId: 'budget-1' })).rejects.toThrow(
      BudgetNotFoundError,
    );
  });
});

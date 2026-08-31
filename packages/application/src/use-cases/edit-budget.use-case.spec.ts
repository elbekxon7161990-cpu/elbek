import type { Budget, BudgetRepository, CategoryReference, CategoryRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetNotFoundError } from '../errors/budget-not-found.error';
import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { UnauthorizedBudgetAccessError } from '../errors/unauthorized-budget-access.error';
import { EditBudgetUseCase } from './edit-budget.use-case';

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

describe('EditBudgetUseCase', () => {
  let budgetRepository: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let categoryRepository: { findById: ReturnType<typeof vi.fn> };
  let useCase: EditBudgetUseCase;

  beforeEach(() => {
    budgetRepository = {
      findById: vi.fn().mockResolvedValue(makeBudget()),
      update: vi
        .fn()
        .mockImplementation((_id, _userId, changes) => Promise.resolve(makeBudget(changes))),
    };
    categoryRepository = {
      findById: vi
        .fn()
        .mockResolvedValue({ id: 'category-2', status: 'active' } as CategoryReference),
    };

    useCase = new EditBudgetUseCase(
      budgetRepository as unknown as BudgetRepository,
      categoryRepository as unknown as CategoryRepository,
    );
  });

  it('edits the limit amount (FR-BUD-007)', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      budgetId: 'budget-1',
      changes: { limitAmount: '2000000' },
    });

    expect(budgetRepository.update).toHaveBeenCalledWith('budget-1', 'user-1', {
      limitAmount: '2000000',
    });
    expect(result.limitAmount).toBe('2000000');
  });

  it('edits the category, validating the new category exists and is active', async () => {
    await useCase.execute({
      userId: 'user-1',
      budgetId: 'budget-1',
      changes: { categoryId: 'category-2' },
    });

    expect(categoryRepository.findById).toHaveBeenCalledWith('category-2');
    expect(budgetRepository.update).toHaveBeenCalledWith('budget-1', 'user-1', {
      categoryId: 'category-2',
    });
  });

  it('throws BudgetNotFoundError when the budget does not exist', async () => {
    budgetRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ userId: 'user-1', budgetId: 'missing', changes: {} }),
    ).rejects.toThrow(BudgetNotFoundError);
    expect(budgetRepository.update).not.toHaveBeenCalled();
  });

  it('throws BudgetNotFoundError when the budget is already soft-deleted', async () => {
    budgetRepository.findById.mockResolvedValue(
      makeBudget({ deletedAt: new Date(), isDeleted: true }),
    );

    await expect(
      useCase.execute({ userId: 'user-1', budgetId: 'budget-1', changes: {} }),
    ).rejects.toThrow(BudgetNotFoundError);
  });

  it('throws UnauthorizedBudgetAccessError when the budget belongs to a different user (never trusts client-supplied id alone)', async () => {
    budgetRepository.findById.mockResolvedValue(makeBudget({ userId: 'other-user' }));

    await expect(
      useCase.execute({ userId: 'user-1', budgetId: 'budget-1', changes: { limitAmount: '1' } }),
    ).rejects.toThrow(UnauthorizedBudgetAccessError);
    expect(budgetRepository.update).not.toHaveBeenCalled();
  });

  it('throws CategoryNotFoundError for a deprecated/non-existent new category', async () => {
    categoryRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({
        userId: 'user-1',
        budgetId: 'budget-1',
        changes: { categoryId: 'missing-category' },
      }),
    ).rejects.toThrow(CategoryNotFoundError);
    expect(budgetRepository.update).not.toHaveBeenCalled();
  });

  it("throws BudgetNotFoundError when the repository's own atomic update matches zero rows (concurrent delete race)", async () => {
    budgetRepository.update.mockResolvedValue(null);

    await expect(
      useCase.execute({ userId: 'user-1', budgetId: 'budget-1', changes: { limitAmount: '1' } }),
    ).rejects.toThrow(BudgetNotFoundError);
  });
});

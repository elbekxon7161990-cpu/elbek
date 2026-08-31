import type {
  Budget,
  BudgetRepository,
  CategoryReference,
  CategoryRepository,
  CurrencyRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { DuplicateBudgetError, InvalidBudgetError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type CreateBudgetInput, CreateBudgetUseCase } from './create-budget.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

function makeCategory(overrides: Partial<CategoryReference> = {}): CategoryReference {
  return { id: 'category-1', status: 'active', ...overrides };
}

function makeInput(overrides: Partial<CreateBudgetInput> = {}): CreateBudgetInput {
  return {
    userId: 'user-1',
    scopeType: 'category',
    categoryId: 'category-1',
    limitAmount: '1500000',
    currency: 'UZS',
    periodType: 'monthly',
    ...overrides,
  };
}

describe('CreateBudgetUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: { findById: ReturnType<typeof vi.fn> };
  let budgetRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: CreateBudgetUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = { findById: vi.fn().mockResolvedValue(makeCategory()) };
    budgetRepository = {
      create: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'budget-1',
          status: 'active',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Budget),
      ),
    };

    useCase = new CreateBudgetUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository as unknown as CategoryRepository,
      budgetRepository as unknown as BudgetRepository,
    );
  });

  it('creates a category-scope budget with correctly computed monthly period boundaries (FR-BUD-001/003)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
    try {
      const result = await useCase.execute(makeInput());

      expect(result.kind).toBe('created');
      expect(budgetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: 'category',
          categoryId: 'category-1',
          currentPeriodStart: new Date('2026-08-01'),
          currentPeriodEnd: new Date('2026-08-31'),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates an overall-scope budget with categoryId null', async () => {
    const result = await useCase.execute(
      makeInput({ scopeType: 'overall', categoryId: undefined }),
    );

    expect(result.kind).toBe('created');
    expect(budgetRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'overall', categoryId: null }),
    );
    expect(categoryRepository.findById).not.toHaveBeenCalled();
  });

  it('returns a "duplicate" outcome (never throws) when the repository reports a conflicting scope (§8.4.7)', async () => {
    budgetRepository.create.mockRejectedValue(new DuplicateBudgetError('existing-budget-id'));

    const result = await useCase.execute(makeInput());

    expect(result).toEqual({ kind: 'duplicate', existingBudgetId: 'existing-budget-id' });
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(budgetRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidCurrencyError for an unsupported currency', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput())).rejects.toThrow(InvalidCurrencyError);
    expect(budgetRepository.create).not.toHaveBeenCalled();
  });

  it('throws CategoryNotFoundError for a category-scope budget with no categoryId supplied', async () => {
    await expect(useCase.execute(makeInput({ categoryId: undefined }))).rejects.toThrow(
      CategoryNotFoundError,
    );
    expect(budgetRepository.create).not.toHaveBeenCalled();
  });

  it('throws CategoryNotFoundError for a deprecated/non-existent category', async () => {
    categoryRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(CategoryNotFoundError);
    expect(budgetRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidBudgetError for a zero/negative limitAmount', async () => {
    await expect(useCase.execute(makeInput({ limitAmount: '0' }))).rejects.toThrow(
      InvalidBudgetError,
    );
    expect(budgetRepository.create).not.toHaveBeenCalled();
  });
});

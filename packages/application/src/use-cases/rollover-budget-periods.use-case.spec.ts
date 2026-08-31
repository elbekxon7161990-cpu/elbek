import type { Budget, BudgetRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RolloverBudgetPeriodsUseCase } from './rollover-budget-periods.use-case';

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    userId: 'user-1',
    scopeType: 'category',
    categoryId: 'category-1',
    limitAmount: '1000000',
    currency: 'UZS',
    periodType: 'monthly',
    currentPeriodStart: new Date('2026-07-01'),
    currentPeriodEnd: new Date('2026-07-31'),
    status: 'active',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    ...overrides,
  } as Budget;
}

describe('RolloverBudgetPeriodsUseCase (FR-BUD-003)', () => {
  let budgetRepository: {
    findDueForRollover: ReturnType<typeof vi.fn>;
    rolloverPeriod: ReturnType<typeof vi.fn>;
  };
  let useCase: RolloverBudgetPeriodsUseCase;

  beforeEach(() => {
    budgetRepository = {
      findDueForRollover: vi.fn().mockResolvedValue([]),
      rolloverPeriod: vi.fn().mockResolvedValue(makeBudget()),
    };
    useCase = new RolloverBudgetPeriodsUseCase(budgetRepository as unknown as BudgetRepository);
  });

  it('rolls a monthly budget forward to the immediately-following month', async () => {
    budgetRepository.findDueForRollover.mockResolvedValue([makeBudget()]);

    const summary = await useCase.execute(new Date('2026-08-01T12:00:00Z'));

    expect(budgetRepository.rolloverPeriod).toHaveBeenCalledWith(
      'budget-1',
      new Date('2026-07-31'),
      new Date('2026-08-01'),
      new Date('2026-08-31'),
    );
    expect(summary).toEqual({ candidatesScanned: 1, rolledOver: 1, skippedAsRace: 0 });
  });

  it('counts a null rolloverPeriod result as skippedAsRace, not an error (concurrent rollover already advanced it)', async () => {
    budgetRepository.findDueForRollover.mockResolvedValue([makeBudget()]);
    budgetRepository.rolloverPeriod.mockResolvedValue(null);

    const summary = await useCase.execute();

    expect(summary).toEqual({ candidatesScanned: 1, rolledOver: 0, skippedAsRace: 1 });
  });

  it('rolls over multiple due budgets independently, aggregating the summary', async () => {
    budgetRepository.findDueForRollover.mockResolvedValue([
      makeBudget({ id: 'budget-1' }),
      makeBudget({
        id: 'budget-2',
        periodType: 'weekly',
        currentPeriodStart: new Date('2026-07-27'),
        currentPeriodEnd: new Date('2026-08-02'),
      }),
    ]);

    const summary = await useCase.execute();

    expect(budgetRepository.rolloverPeriod).toHaveBeenCalledTimes(2);
    expect(summary.candidatesScanned).toBe(2);
    expect(summary.rolledOver).toBe(2);
  });

  it('does nothing when no budgets are due for rollover', async () => {
    const summary = await useCase.execute();

    expect(budgetRepository.rolloverPeriod).not.toHaveBeenCalled();
    expect(summary).toEqual({ candidatesScanned: 0, rolledOver: 0, skippedAsRace: 0 });
  });
});

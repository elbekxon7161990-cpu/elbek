import type { Budget, BudgetRepository, BudgetUtilization } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListBudgetsUseCase } from './list-budgets.use-case';

function makeUtilization(overrides: Partial<BudgetUtilization> = {}): BudgetUtilization {
  return {
    budget: { id: 'budget-1' } as Budget,
    usedAmount: '200000',
    utilizationPercent: 13.3,
    remainingAmount: '1300000',
    daysRemainingInPeriod: 15,
    ...overrides,
  };
}

describe('ListBudgetsUseCase (FR-BUD-006)', () => {
  let budgetRepository: { computeUtilizationForAllActive: ReturnType<typeof vi.fn> };
  let useCase: ListBudgetsUseCase;

  beforeEach(() => {
    budgetRepository = {
      computeUtilizationForAllActive: vi.fn().mockResolvedValue([makeUtilization()]),
    };
    useCase = new ListBudgetsUseCase(budgetRepository as unknown as BudgetRepository);
  });

  it('returns every active budget with its live utilization', async () => {
    const result = await useCase.execute({ userId: 'user-1' });

    expect(result).toHaveLength(1);
    expect(budgetRepository.computeUtilizationForAllActive).toHaveBeenCalledWith(
      'user-1',
      expect.any(Date),
    );
  });

  it('passes through an explicit asOf date when supplied', async () => {
    const asOf = new Date('2026-08-15');
    await useCase.execute({ userId: 'user-1', asOf });

    expect(budgetRepository.computeUtilizationForAllActive).toHaveBeenCalledWith('user-1', asOf);
  });
});

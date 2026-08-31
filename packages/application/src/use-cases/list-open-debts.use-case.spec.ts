import type { Debt, DebtRepository } from '@afa/domain';
import { describe, expect, it, vi } from 'vitest';

import { ListOpenDebtsUseCase } from './list-open-debts.use-case';

describe('ListOpenDebtsUseCase (FR-DBT-006)', () => {
  it('delegates to DebtRepository.findOpenByUserId, scoped to the requesting user', async () => {
    const debts = [{ id: 'debt-1' }] as Debt[];
    const debtRepository = { findOpenByUserId: vi.fn().mockResolvedValue(debts) };
    const useCase = new ListOpenDebtsUseCase(debtRepository as unknown as DebtRepository);

    const result = await useCase.execute({ userId: 'user-1' });

    expect(debtRepository.findOpenByUserId).toHaveBeenCalledWith('user-1');
    expect(result).toBe(debts);
  });

  it('returns an empty list when the user has no open debts', async () => {
    const debtRepository = { findOpenByUserId: vi.fn().mockResolvedValue([]) };
    const useCase = new ListOpenDebtsUseCase(debtRepository as unknown as DebtRepository);

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result).toEqual([]);
  });
});

import type { Loan, LoanRepository } from '@afa/domain';
import { describe, expect, it, vi } from 'vitest';

import { ListOpenLoansUseCase } from './list-open-loans.use-case';

describe('ListOpenLoansUseCase', () => {
  it('A — delegates to LoanRepository.findOpenByUserId, scoped to the requesting user (FR-FIN-009)', async () => {
    const loans = [{ id: 'loan-1' } as Loan];
    const loanRepository = { findOpenByUserId: vi.fn().mockResolvedValue(loans) };
    const useCase = new ListOpenLoansUseCase(loanRepository as unknown as LoanRepository);

    const result = await useCase.execute({ userId: 'user-1' });

    expect(loanRepository.findOpenByUserId).toHaveBeenCalledWith('user-1');
    expect(result).toBe(loans);
  });
});

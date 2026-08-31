import type { DebtRepository } from '@afa/domain';
import { Debt } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DebtNotFoundError } from '../errors/debt-not-found.error';
import { DebtNotOpenError } from '../errors/debt-not-open.error';
import { UnauthorizedDebtAccessError } from '../errors/unauthorized-debt-access.error';
import { SettleDebtUseCase } from './settle-debt.use-case';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeDebt(
  overrides: Partial<{ id: string; userId: string; status: 'open' | 'repaid' | 'forgiven' }> = {},
): Debt {
  return new Debt({
    id: overrides.id ?? 'debt-1',
    userId: overrides.userId ?? 'user-1',
    direction: 'given',
    counterpartyName: 'Aziz',
    counterpartyRefId: 'counterparty-1',
    originalAmount: '100000',
    outstandingBalance: overrides.status === 'repaid' ? '0' : '100000',
    currency: 'UZS',
    transactionDate: new Date('2026-08-01'),
    dueDate: new Date('2026-09-01'),
    status: overrides.status ?? 'open',
    notes: null,
    originalText: 'lent 100000 to Aziz',
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

describe('SettleDebtUseCase (FR-DBT-005)', () => {
  let debtRepository: { findById: ReturnType<typeof vi.fn>; forgive: ReturnType<typeof vi.fn> };
  let useCase: SettleDebtUseCase;

  beforeEach(() => {
    debtRepository = {
      findById: vi.fn().mockResolvedValue(makeDebt()),
      forgive: vi.fn().mockResolvedValue(makeDebt({ status: 'forgiven' })),
    };
    useCase = new SettleDebtUseCase(debtRepository as unknown as DebtRepository);
  });

  it('forgives an open debt owned by the requesting user', async () => {
    const result = await useCase.execute({ userId: 'user-1', debtId: 'debt-1' });

    expect(debtRepository.forgive).toHaveBeenCalledWith('debt-1', expect.any(Date));
    expect(result.status).toBe('forgiven');
  });

  it('throws DebtNotFoundError when the debt does not exist', async () => {
    debtRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'user-1', debtId: 'missing' })).rejects.toThrow(
      DebtNotFoundError,
    );
    expect(debtRepository.forgive).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedDebtAccessError when the debt belongs to a different user (BR-DBT-002)', async () => {
    debtRepository.findById.mockResolvedValue(makeDebt({ userId: 'someone-else' }));

    await expect(useCase.execute({ userId: 'user-1', debtId: 'debt-1' })).rejects.toThrow(
      UnauthorizedDebtAccessError,
    );
    expect(debtRepository.forgive).not.toHaveBeenCalled();
  });

  it('throws DebtNotOpenError when the debt is already repaid', async () => {
    debtRepository.findById.mockResolvedValue(makeDebt({ status: 'repaid' }));

    await expect(useCase.execute({ userId: 'user-1', debtId: 'debt-1' })).rejects.toThrow(
      DebtNotOpenError,
    );
    expect(debtRepository.forgive).not.toHaveBeenCalled();
  });

  it('throws DebtNotOpenError when forgive() loses a genuine concurrency race (findById was stale)', async () => {
    debtRepository.forgive.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'user-1', debtId: 'debt-1' })).rejects.toThrow(
      DebtNotOpenError,
    );
  });
});

import type { Account, AccountRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListAccountsUseCase } from './list-accounts.use-case';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    userId: 'user-1',
    name: 'Cash Wallet',
    accountType: 'cash',
    currency: 'UZS',
    startingBalance: '100000',
    isDefault: false,
    status: 'active',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    isDeleted: false,
    ...overrides,
  } as Account;
}

describe('ListAccountsUseCase', () => {
  let accountRepository: { findActiveByUserId: ReturnType<typeof vi.fn> };
  let useCase: ListAccountsUseCase;

  beforeEach(() => {
    accountRepository = { findActiveByUserId: vi.fn().mockResolvedValue([makeAccount()]) };
    useCase = new ListAccountsUseCase(accountRepository as unknown as AccountRepository);
  });

  it('returns the active accounts for the given user, scoped by userId', async () => {
    const result = await useCase.execute({ userId: 'user-1' });

    expect(accountRepository.findActiveByUserId).toHaveBeenCalledWith('user-1');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('account-1');
  });

  it('returns an empty array when the user has no accounts', async () => {
    accountRepository.findActiveByUserId.mockResolvedValue([]);

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result).toEqual([]);
  });
});

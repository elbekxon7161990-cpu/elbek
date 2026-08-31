import type { Account, AccountRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { EditAccountUseCase } from './edit-account.use-case';

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

describe('EditAccountUseCase', () => {
  let accountRepository: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let useCase: EditAccountUseCase;

  beforeEach(() => {
    accountRepository = {
      findById: vi.fn().mockResolvedValue(makeAccount()),
      update: vi
        .fn()
        .mockImplementation((_id, _userId, changes) => Promise.resolve(makeAccount(changes))),
    };

    useCase = new EditAccountUseCase(accountRepository as unknown as AccountRepository);
  });

  it('edits the name (FR-FIN-025)', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      accountId: 'account-1',
      changes: { name: 'Main Card' },
    });

    expect(accountRepository.update).toHaveBeenCalledWith('account-1', 'user-1', {
      name: 'Main Card',
    });
    expect(result.name).toBe('Main Card');
  });

  it('edits the accountType', async () => {
    await useCase.execute({
      userId: 'user-1',
      accountId: 'account-1',
      changes: { accountType: 'savings' },
    });

    expect(accountRepository.update).toHaveBeenCalledWith('account-1', 'user-1', {
      accountType: 'savings',
    });
  });

  it('throws AccountNotFoundError when the account does not exist', async () => {
    accountRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ userId: 'user-1', accountId: 'missing', changes: {} }),
    ).rejects.toThrow(AccountNotFoundError);
    expect(accountRepository.update).not.toHaveBeenCalled();
  });

  it('throws AccountNotFoundError when the account is already soft-deleted', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ deletedAt: new Date(), isDeleted: true }),
    );

    await expect(
      useCase.execute({ userId: 'user-1', accountId: 'account-1', changes: {} }),
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('throws UnauthorizedAccountAccessError when the account belongs to a different user (never trusts client-supplied id alone)', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount({ userId: 'other-user' }));

    await expect(
      useCase.execute({ userId: 'user-1', accountId: 'account-1', changes: { name: 'x' } }),
    ).rejects.toThrow(UnauthorizedAccountAccessError);
    expect(accountRepository.update).not.toHaveBeenCalled();
  });

  it("throws AccountNotFoundError when the repository's own atomic update matches zero rows (concurrent delete race)", async () => {
    accountRepository.update.mockResolvedValue(null);

    await expect(
      useCase.execute({ userId: 'user-1', accountId: 'account-1', changes: { name: 'x' } }),
    ).rejects.toThrow(AccountNotFoundError);
  });
});

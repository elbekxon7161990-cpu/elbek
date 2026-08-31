import type { Account, AccountRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { DeleteAccountUseCase } from './delete-account.use-case';

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

describe('DeleteAccountUseCase', () => {
  let accountRepository: { findById: ReturnType<typeof vi.fn>; archive: ReturnType<typeof vi.fn> };
  let useCase: DeleteAccountUseCase;

  beforeEach(() => {
    accountRepository = {
      findById: vi.fn().mockResolvedValue(makeAccount()),
      archive: vi
        .fn()
        .mockImplementation((_id, _userId) =>
          Promise.resolve(makeAccount({ status: 'archived', isArchived: true })),
        ),
    };

    useCase = new DeleteAccountUseCase(accountRepository as unknown as AccountRepository);
  });

  it('archives the account (FR-FIN-025 — archiving IS soft-deleting)', async () => {
    const result = await useCase.execute({ userId: 'user-1', accountId: 'account-1' });

    expect(accountRepository.archive).toHaveBeenCalledWith('account-1', 'user-1');
    expect(result.status).toBe('archived');
  });

  it('throws AccountNotFoundError when the account does not exist', async () => {
    accountRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'user-1', accountId: 'missing' })).rejects.toThrow(
      AccountNotFoundError,
    );
    expect(accountRepository.archive).not.toHaveBeenCalled();
  });

  it('throws AccountNotFoundError when the account is already soft-deleted', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ deletedAt: new Date(), isDeleted: true }),
    );

    await expect(useCase.execute({ userId: 'user-1', accountId: 'account-1' })).rejects.toThrow(
      AccountNotFoundError,
    );
  });

  it('throws UnauthorizedAccountAccessError when the account belongs to a different user', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount({ userId: 'other-user' }));

    await expect(useCase.execute({ userId: 'user-1', accountId: 'account-1' })).rejects.toThrow(
      UnauthorizedAccountAccessError,
    );
    expect(accountRepository.archive).not.toHaveBeenCalled();
  });

  it("throws AccountNotFoundError when the repository's own atomic archive matches zero rows (already archived / concurrent race)", async () => {
    accountRepository.archive.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'user-1', accountId: 'account-1' })).rejects.toThrow(
      AccountNotFoundError,
    );
  });
});

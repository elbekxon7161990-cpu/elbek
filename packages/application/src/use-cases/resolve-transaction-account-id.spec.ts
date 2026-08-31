import type { Account, AccountRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { resolveTransactionAccountId } from './resolve-transaction-account-id';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    userId: 'user-1',
    name: 'Cash Wallet',
    accountType: 'cash',
    currency: 'UZS',
    startingBalance: '0',
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

describe('resolveTransactionAccountId', () => {
  let accountRepository: {
    findById: ReturnType<typeof vi.fn>;
    findOrCreateDefaultForCurrency: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    accountRepository = {
      findById: vi.fn().mockResolvedValue(makeAccount()),
      findOrCreateDefaultForCurrency: vi.fn().mockResolvedValue(makeAccount({ id: 'default-1' })),
    };
  });

  it('resolves the implicit default account when accountId is omitted (§8.12.4)', async () => {
    const result = await resolveTransactionAccountId(
      accountRepository as unknown as AccountRepository,
      'user-1',
      'UZS',
      undefined,
    );

    expect(accountRepository.findOrCreateDefaultForCurrency).toHaveBeenCalledWith('user-1', 'UZS');
    expect(result).toBe('default-1');
    expect(accountRepository.findById).not.toHaveBeenCalled();
  });

  it('validates and returns an explicitly-supplied accountId', async () => {
    const result = await resolveTransactionAccountId(
      accountRepository as unknown as AccountRepository,
      'user-1',
      'UZS',
      'account-1',
    );

    expect(accountRepository.findById).toHaveBeenCalledWith('account-1');
    expect(result).toBe('account-1');
    expect(accountRepository.findOrCreateDefaultForCurrency).not.toHaveBeenCalled();
  });

  it('throws AccountNotFoundError when the explicit accountId does not exist', async () => {
    accountRepository.findById.mockResolvedValue(null);

    await expect(
      resolveTransactionAccountId(
        accountRepository as unknown as AccountRepository,
        'user-1',
        'UZS',
        'missing',
      ),
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('throws AccountNotFoundError when the explicit accountId is soft-deleted', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ deletedAt: new Date(), isDeleted: true }),
    );

    await expect(
      resolveTransactionAccountId(
        accountRepository as unknown as AccountRepository,
        'user-1',
        'UZS',
        'account-1',
      ),
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('throws UnauthorizedAccountAccessError when the explicit accountId belongs to a different user', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount({ userId: 'other-user' }));

    await expect(
      resolveTransactionAccountId(
        accountRepository as unknown as AccountRepository,
        'user-1',
        'UZS',
        'account-1',
      ),
    ).rejects.toThrow(UnauthorizedAccountAccessError);
  });

  it('allows an explicit accountId whose own currency differs from the transaction currency (no FR requires a match)', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount({ currency: 'USD' }));

    const result = await resolveTransactionAccountId(
      accountRepository as unknown as AccountRepository,
      'user-1',
      'UZS',
      'account-1',
    );

    expect(result).toBe('account-1');
  });
});

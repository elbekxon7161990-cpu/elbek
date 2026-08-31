import type {
  Account,
  AccountRepository,
  CurrencyRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidAccountError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type CreateAccountInput, CreateAccountUseCase } from './create-account.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

function makeInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  return {
    userId: 'user-1',
    name: 'Cash Wallet',
    accountType: 'cash',
    currency: 'UZS',
    startingBalance: '100000',
    ...overrides,
  };
}

describe('CreateAccountUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let accountRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: CreateAccountUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    accountRepository = {
      create: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'account-1',
          status: 'active',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Account),
      ),
    };

    useCase = new CreateAccountUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      accountRepository as unknown as AccountRepository,
    );
  });

  it('creates an account with isDefault always false (FR-FIN-022 — §8.12.4 default-account is system-provisioned only)', async () => {
    const result = await useCase.execute(makeInput());

    expect(accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        name: 'Cash Wallet',
        accountType: 'cash',
        currency: 'UZS',
        startingBalance: '100000',
        isDefault: false,
      }),
    );
    expect(result.id).toBe('account-1');
  });

  it('accepts a negative startingBalance (§8.12.3 — credit-card-style account)', async () => {
    await useCase.execute(makeInput({ startingBalance: '-50000' }));

    expect(accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ startingBalance: '-50000' }),
    );
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(accountRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidCurrencyError for an unsupported currency', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput({ currency: 'XXX' }))).rejects.toThrow(
      InvalidCurrencyError,
    );
    expect(accountRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidAccountError for an invalid accountType, before ever calling the repository', async () => {
    await expect(
      useCase.execute(makeInput({ accountType: 'invalid-type' as never })),
    ).rejects.toThrow(InvalidAccountError);
    expect(accountRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidAccountError for a malformed startingBalance, before ever calling the repository', async () => {
    await expect(useCase.execute(makeInput({ startingBalance: 'not-a-number' }))).rejects.toThrow(
      InvalidAccountError,
    );
    expect(accountRepository.create).not.toHaveBeenCalled();
  });
});

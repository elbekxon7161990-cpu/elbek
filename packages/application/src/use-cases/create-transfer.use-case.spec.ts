import type {
  Account,
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  FxRateRepository,
  SavingsGoal,
  SavingsGoalRepository,
  TransactionRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidTransactionError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { MissingDestinationAmountError } from '../errors/missing-destination-amount.error';
import { SavingsGoalNotFoundError } from '../errors/savings-goal-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { UnauthorizedGoalAccessError } from '../errors/unauthorized-goal-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type CreateTransferInput, CreateTransferUseCase } from './create-transfer.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', defaultCurrency: 'UZS', ...overrides } as User;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-cash',
    userId: 'user-1',
    name: 'Cash',
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

function makeGoal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'goal-1',
    userId: 'user-1',
    name: 'Vacation fund',
    targetAmount: '5000000.00',
    currency: 'UZS',
    targetDate: null,
    status: 'active',
    lastMilestoneFired: null,
    deletedAt: null,
    createdAt: new Date(),
    isDeleted: false,
    isCompleted: false,
    ...overrides,
  } as SavingsGoal;
}

function makeInput(overrides: Partial<CreateTransferInput> = {}): CreateTransferInput {
  return {
    userId: 'user-1',
    sourceAccountId: 'account-cash',
    destinationAccountId: 'account-bank',
    amount: '45000.00',
    transactionDate: new Date('2026-08-17'),
    description: 'Move cash to bank',
    originalText: 'moved 45000 from cash to bank',
    sourceType: 'manual',
    createdBy: 'user_manual',
    ...overrides,
  };
}

describe('CreateTransferUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: {
    findById: ReturnType<typeof vi.fn>;
    findByCode: ReturnType<typeof vi.fn>;
  };
  let accountRepository: { findById: ReturnType<typeof vi.fn> };
  let savingsGoalRepository: { findById: ReturnType<typeof vi.fn> };
  let fxRateRepository: { findRate: ReturnType<typeof vi.fn> };
  let transactionRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: CreateTransferUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = {
      findById: vi.fn().mockResolvedValue({ id: 'category-transfer', status: 'active' }),
      findByCode: vi.fn().mockResolvedValue({ id: 'category-transfer', status: 'active' }),
    };
    accountRepository = {
      findById: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(
            id === 'account-cash'
              ? makeAccount({ id: 'account-cash', currency: 'UZS' })
              : id === 'account-bank'
                ? makeAccount({ id: 'account-bank', currency: 'UZS' })
                : id === 'account-usd'
                  ? makeAccount({ id: 'account-usd', currency: 'USD' })
                  : null,
          ),
        ),
    };
    savingsGoalRepository = { findById: vi.fn().mockResolvedValue(makeGoal()) };
    fxRateRepository = {
      findRate: vi
        .fn()
        .mockResolvedValue({ rate: '1', asOfDate: new Date(), isApproximate: false }),
    };
    transactionRepository = {
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'txn-1', ...data })),
    };

    useCase = new CreateTransferUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository as unknown as CategoryRepository,
      accountRepository as unknown as AccountRepository,
      savingsGoalRepository as unknown as SavingsGoalRepository,
      fxRateRepository as unknown as FxRateRepository,
      transactionRepository as unknown as TransactionRepository,
    );
  });

  it('A — creates a valid same-currency TRANSFER (AC-FIN-002)', async () => {
    const result = await useCase.execute(makeInput());

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionType: 'TRANSFER',
        sourceAccountId: 'account-cash',
        destinationAccountId: 'account-bank',
        currency: 'UZS',
        categoryId: 'category-transfer',
        destinationAmount: undefined,
      }),
    );
    expect(result.id).toBe('txn-1');
  });

  it('B — rejects when the user does not exist (missing entity)', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('C — rejects when the source account does not exist (missing entity)', async () => {
    accountRepository.findById.mockImplementation((id: string) =>
      Promise.resolve(id === 'account-bank' ? makeAccount({ id: 'account-bank' }) : null),
    );

    await expect(useCase.execute(makeInput())).rejects.toThrow(AccountNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('D — rejects when the destination account does not exist (missing entity)', async () => {
    accountRepository.findById.mockImplementation((id: string) =>
      Promise.resolve(id === 'account-cash' ? makeAccount({ id: 'account-cash' }) : null),
    );

    await expect(useCase.execute(makeInput())).rejects.toThrow(AccountNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('E — rejects when the source account belongs to another user (ownership failure)', async () => {
    accountRepository.findById.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'account-cash'
          ? makeAccount({ id: 'account-cash', userId: 'other-user' })
          : makeAccount({ id: 'account-bank' }),
      ),
    );

    await expect(useCase.execute(makeInput())).rejects.toThrow(UnauthorizedAccountAccessError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('F — rejects when the destination account belongs to another user (ownership failure)', async () => {
    accountRepository.findById.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'account-bank'
          ? makeAccount({ id: 'account-bank', userId: 'other-user' })
          : makeAccount({ id: 'account-cash' }),
      ),
    );

    await expect(useCase.execute(makeInput())).rejects.toThrow(UnauthorizedAccountAccessError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('G — rejects a TRANSFER using the same account as source and destination (§8.7.5, AC-FIN-007)', async () => {
    await expect(
      useCase.execute(
        makeInput({ sourceAccountId: 'account-cash', destinationAccountId: 'account-cash' }),
      ),
    ).rejects.toThrow(InvalidTransactionError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('H — rejects an invalid (non-positive) amount', async () => {
    await expect(useCase.execute(makeInput({ amount: '-100' }))).rejects.toThrow(
      InvalidTransactionError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('I — a cross-currency transfer with a supplied destinationAmount succeeds (FR-FIN-005)', async () => {
    const result = await useCase.execute(
      makeInput({ destinationAccountId: 'account-usd', destinationAmount: '3.60' }),
    );

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ destinationAmount: '3.60', currency: 'UZS' }),
    );
    expect(result.id).toBe('txn-1');
  });

  it('J — a cross-currency transfer WITHOUT a supplied destinationAmount is rejected, not silently estimated (Stage C scope decision)', async () => {
    await expect(
      useCase.execute(makeInput({ destinationAccountId: 'account-usd' })),
    ).rejects.toThrow(MissingDestinationAmountError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('K — rejects when the "TRANSFER" system category cannot be found', async () => {
    categoryRepository.findByCode.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(CategoryNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  describe('linked-transfer savings-goal contribution mode (FR-FIN-012)', () => {
    it('L — persists a TRANSFER linked to an owned, existing savings goal', async () => {
      const result = await useCase.execute(makeInput({ goalId: 'goal-1' }));

      expect(savingsGoalRepository.findById).toHaveBeenCalledWith('goal-1');
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ goalId: 'goal-1' }),
      );
      expect(result.id).toBe('txn-1');
    });

    it('M — rejects when the linked goal does not exist (missing entity)', async () => {
      savingsGoalRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(makeInput({ goalId: 'goal-1' }))).rejects.toThrow(
        SavingsGoalNotFoundError,
      );
      expect(transactionRepository.create).not.toHaveBeenCalled();
    });

    it('N — rejects when the linked goal belongs to another user (ownership failure)', async () => {
      savingsGoalRepository.findById.mockResolvedValue(makeGoal({ userId: 'other-user' }));

      await expect(useCase.execute(makeInput({ goalId: 'goal-1' }))).rejects.toThrow(
        UnauthorizedGoalAccessError,
      );
      expect(transactionRepository.create).not.toHaveBeenCalled();
    });
  });
});

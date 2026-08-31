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
import { SavingsGoalNotFoundError } from '../errors/savings-goal-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { UnauthorizedGoalAccessError } from '../errors/unauthorized-goal-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import {
  ContributeToSavingsGoalUseCase,
  type ContributeToSavingsGoalInput,
} from './contribute-to-savings-goal.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', defaultCurrency: 'UZS', ...overrides } as User;
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

function makeInput(
  overrides: Partial<ContributeToSavingsGoalInput> = {},
): ContributeToSavingsGoalInput {
  return {
    userId: 'user-1',
    goalId: 'goal-1',
    amount: '250000.00',
    currency: 'UZS',
    transactionDate: new Date('2026-08-17'),
    description: 'Contribution toward vacation fund',
    originalText: 'put aside 250000 for vacation',
    sourceType: 'manual',
    createdBy: 'user_manual',
    ...overrides,
  };
}

describe('ContributeToSavingsGoalUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: {
    findById: ReturnType<typeof vi.fn>;
    findByCode: ReturnType<typeof vi.fn>;
  };
  let savingsGoalRepository: { findById: ReturnType<typeof vi.fn> };
  let accountRepository: { findById: ReturnType<typeof vi.fn> };
  let fxRateRepository: { findRate: ReturnType<typeof vi.fn> };
  let transactionRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: ContributeToSavingsGoalUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = {
      findById: vi.fn().mockResolvedValue({ id: 'category-savings', status: 'active' }),
      findByCode: vi.fn().mockResolvedValue({ id: 'category-savings', status: 'active' }),
    };
    savingsGoalRepository = { findById: vi.fn().mockResolvedValue(makeGoal()) };
    accountRepository = { findById: vi.fn().mockResolvedValue(makeAccount()) };
    fxRateRepository = {
      findRate: vi
        .fn()
        .mockResolvedValue({ rate: '1', asOfDate: new Date(), isApproximate: false }),
    };
    transactionRepository = {
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'txn-1', ...data })),
    };

    useCase = new ContributeToSavingsGoalUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository as unknown as CategoryRepository,
      savingsGoalRepository as unknown as SavingsGoalRepository,
      accountRepository as unknown as AccountRepository,
      fxRateRepository as unknown as FxRateRepository,
      transactionRepository as unknown as TransactionRepository,
    );
  });

  it('A — creates a standalone GOAL_CONTRIBUTION (AC-FIN-004)', async () => {
    const result = await useCase.execute(makeInput());

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionType: 'GOAL_CONTRIBUTION',
        goalId: 'goal-1',
        categoryId: 'category-savings',
        accountId: undefined,
      }),
    );
    expect(result.id).toBe('txn-1');
  });

  it('B — never sets sourceAccountId/destinationAccountId (standalone mode, BR-FIN-003)', async () => {
    await useCase.execute(makeInput());

    const created = transactionRepository.create.mock.calls[0][0];
    expect(created.sourceAccountId).toBeUndefined();
    expect(created.destinationAccountId).toBeUndefined();
  });

  it('C — accepts an optional accountId for attribution only (FR-FIN-023 generalization)', async () => {
    await useCase.execute(makeInput({ accountId: 'account-cash' }));

    expect(accountRepository.findById).toHaveBeenCalledWith('account-cash');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-cash' }),
    );
  });

  it('D — rejects when the supplied accountId does not exist (missing entity)', async () => {
    accountRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput({ accountId: 'account-cash' }))).rejects.toThrow(
      AccountNotFoundError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('E — rejects when the supplied accountId belongs to another user (ownership failure)', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount({ userId: 'other-user' }));

    await expect(useCase.execute(makeInput({ accountId: 'account-cash' }))).rejects.toThrow(
      UnauthorizedAccountAccessError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('F — rejects when the goal does not exist (missing entity)', async () => {
    savingsGoalRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(SavingsGoalNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('G — rejects when the goal belongs to another user (ownership failure)', async () => {
    savingsGoalRepository.findById.mockResolvedValue(makeGoal({ userId: 'other-user' }));

    await expect(useCase.execute(makeInput())).rejects.toThrow(UnauthorizedGoalAccessError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('H — allows contributing to an already-"completed" goal (FR-FIN-014 — further contributions remain possible)', async () => {
    savingsGoalRepository.findById.mockResolvedValue(
      makeGoal({ status: 'completed', isCompleted: true }),
    );

    const result = await useCase.execute(makeInput());

    expect(result.id).toBe('txn-1');
    expect(transactionRepository.create).toHaveBeenCalled();
  });

  it('I — rejects when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('J — rejects when the "SAVINGS" system category cannot be found', async () => {
    categoryRepository.findByCode.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(CategoryNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('K — rejects an invalid (non-positive) amount', async () => {
    await expect(useCase.execute(makeInput({ amount: '-100' }))).rejects.toThrow(
      InvalidTransactionError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

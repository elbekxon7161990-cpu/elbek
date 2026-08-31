import type {
  Account,
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  ExpenseHistoryRepository,
  FxRateRepository,
  TransactionRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidTransactionError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidCategoryError } from '../errors/invalid-category.error';
import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type CreateExpenseInput, CreateExpenseUseCase } from './create-expense.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', defaultCurrency: 'UZS', ...overrides } as User;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'default-account-1',
    userId: 'user-1',
    name: 'Default (UZS)',
    accountType: 'other',
    currency: 'UZS',
    startingBalance: '0',
    isDefault: true,
    status: 'active',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    isDeleted: false,
    ...overrides,
  } as Account;
}

function makeInput(overrides: Partial<CreateExpenseInput> = {}): CreateExpenseInput {
  return {
    userId: 'user-1',
    amount: '45000',
    currency: 'UZS',
    categoryId: 'category-food',
    transactionDate: new Date('2026-01-15'),
    description: 'Lunch',
    originalText: 'spent 45000 on lunch',
    sourceType: 'text',
    createdBy: 'ai',
    ...overrides,
  };
}

describe('CreateExpenseUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: { findById: ReturnType<typeof vi.fn> };
  let transactionRepository: { create: ReturnType<typeof vi.fn> };
  let expenseHistoryRepository: { getTrailingAverageExpenseAmount: ReturnType<typeof vi.fn> };
  let accountRepository: {
    findById: ReturnType<typeof vi.fn>;
    findOrCreateDefaultForCurrency: ReturnType<typeof vi.fn>;
  };
  let fxRateRepository: { findRate: ReturnType<typeof vi.fn> };
  let useCase: CreateExpenseUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = {
      findById: vi.fn().mockResolvedValue({ id: 'category-food', status: 'active' }),
    };
    transactionRepository = {
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'txn-1', ...data })),
    };
    expenseHistoryRepository = { getTrailingAverageExpenseAmount: vi.fn().mockResolvedValue(null) };
    accountRepository = {
      findById: vi.fn().mockResolvedValue(makeAccount()),
      findOrCreateDefaultForCurrency: vi.fn().mockResolvedValue(makeAccount()),
    };
    fxRateRepository = {
      findRate: vi.fn().mockResolvedValue({
        rate: '12500.00',
        asOfDate: new Date('2026-01-15'),
        isApproximate: false,
      }),
    };

    useCase = new CreateExpenseUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository as unknown as CategoryRepository,
      transactionRepository as unknown as TransactionRepository,
      expenseHistoryRepository as unknown as ExpenseHistoryRepository,
      accountRepository as unknown as AccountRepository,
      fxRateRepository as unknown as FxRateRepository,
    );
  });

  it('creates a valid EXPENSE transaction (AC-EXP-001)', async () => {
    const result = await useCase.execute(makeInput());

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: 'EXPENSE', amount: '45000' }),
    );
    expect(result.transaction).toMatchObject({ id: 'txn-1', transactionType: 'EXPENSE' });
  });

  it('rejects an invalid amount (FR-EXP-002)', async () => {
    await expect(useCase.execute(makeInput({ amount: '-100' }))).rejects.toThrow(
      InvalidTransactionError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported currency (FR-EXP-003)', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput({ currency: 'XYZ' }))).rejects.toThrow(
      InvalidCurrencyError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a missing category (BR-EXP-001)', async () => {
    categoryRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(InvalidCategoryError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a deprecated category (BR-EXP-001)', async () => {
    categoryRepository.findById.mockResolvedValue({ id: 'category-food', status: 'deprecated' });

    await expect(useCase.execute(makeInput())).rejects.toThrow(InvalidCategoryError);
  });

  it('rejects a future-dated transaction (BR-EXP-002)', async () => {
    await expect(
      useCase.execute(makeInput({ transactionDate: new Date('2999-01-01') })),
    ).rejects.toThrow(InvalidTransactionError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects creation when the user does not exist (user/ownership validation)', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  describe('BR-EXP-002 — user-timezone-aware future-date validation', () => {
    it('accepts a date that is today in the user’s timezone even though it is tomorrow in UTC', async () => {
      userRepository.findById.mockResolvedValue(makeUser({ timezone: 'Asia/Tashkent' })); // UTC+5

      const realDateNow = Date;
      const fixedNow = new realDateNow('2026-01-15T20:00:00Z'); // 01:00 on the 16th in Asia/Tashkent
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);
      try {
        await expect(
          useCase.execute(makeInput({ transactionDate: new Date('2026-01-16') })),
        ).resolves.toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects a date that is still in the future in the user’s timezone', async () => {
      userRepository.findById.mockResolvedValue(makeUser({ timezone: 'Asia/Tashkent' }));

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T20:00:00Z')); // local date is 2026-01-16
      try {
        await expect(
          useCase.execute(makeInput({ transactionDate: new Date('2026-01-17') })),
        ).rejects.toThrow(InvalidTransactionError);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('FR-EXP-004 — large-amount sanity check (never blocks)', () => {
    it('does not flag when there is no historical average (zero historical expenses)', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue(null);

      const result = await useCase.execute(makeInput({ amount: '999999999' }));

      expect(result.largeAmountFlagged).toBe(false);
      expect(transactionRepository.create).toHaveBeenCalled();
    });

    it('computes the average from a single historical expense', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('5000');

      const result = await useCase.execute(makeInput({ amount: '50000.01' }));

      expect(result.largeAmountFlagged).toBe(true);
    });

    it('uses the average across multiple historical expenses (delegated to the repository’s AVG query)', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('12000');

      const result = await useCase.execute(makeInput({ amount: '50000' }));

      expect(result.largeAmountFlagged).toBe(false); // 50000 < 10 * 12000
    });

    it('does not flag an amount exactly 10x the average', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('5000');

      const result = await useCase.execute(makeInput({ amount: '50000' }));

      expect(result.largeAmountFlagged).toBe(false);
    });

    it('flags an amount greater than 10x the average', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('5000');

      const result = await useCase.execute(makeInput({ amount: '50000.01' }));

      expect(result.largeAmountFlagged).toBe(true);
    });

    it('does not flag an amount less than 10x the average', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('5000');

      const result = await useCase.execute(makeInput({ amount: '10000' }));

      expect(result.largeAmountFlagged).toBe(false);
    });

    it('excludes deleted historical expenses / expenses older than 90 days — delegated entirely to the repository query, verified by construction (the use case only ever sees the single aggregate value the port returns)', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('1000000');

      const result = await useCase.execute(makeInput({ amount: '45000' }));

      expect(result.largeAmountFlagged).toBe(false);
      expect(expenseHistoryRepository.getTrailingAverageExpenseAmount).toHaveBeenCalledWith(
        'user-1',
        'UZS',
        expect.any(Date),
      );
    });

    it('never includes the transaction being created in its own average (computed before persistence)', async () => {
      const callOrder: string[] = [];
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockImplementation(async () => {
        callOrder.push('average');
        return '5000';
      });
      transactionRepository.create.mockImplementation(async (data) => {
        callOrder.push('create');
        return { id: 'txn-1', ...data };
      });

      await useCase.execute(makeInput());

      expect(callOrder).toEqual(['average', 'create']);
    });

    it('still creates the transaction successfully when the sanity flag fires (never blocks)', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('100');

      const result = await useCase.execute(makeInput({ amount: '5000' }));

      expect(result.largeAmountFlagged).toBe(true);
      expect(result.transaction).toBeDefined();
      expect(transactionRepository.create).toHaveBeenCalledTimes(1);
    });

    it('compares with decimal precision, without floating-point error', async () => {
      expenseHistoryRepository.getTrailingAverageExpenseAmount.mockResolvedValue('33333.33');

      const notFlagged = await useCase.execute(makeInput({ amount: '333333.30' }));
      expect(notFlagged.largeAmountFlagged).toBe(false);

      const flagged = await useCase.execute(makeInput({ amount: '333333.31' }));
      expect(flagged.largeAmountFlagged).toBe(true);
    });

    it('queries the average using the new transaction’s own currency (same-currency-only comparison)', async () => {
      await useCase.execute(makeInput({ currency: 'USD' }));

      expect(expenseHistoryRepository.getTrailingAverageExpenseAmount).toHaveBeenCalledWith(
        'user-1',
        'USD',
        expect.any(Date),
      );
    });
  });

  describe('TASK-FIN-007 Stage E — account linkage and FX snapshot', () => {
    it('resolves the implicit default account and exchangeRateToDefault "1" for a same-currency expense (FR-FIN-023/027)', async () => {
      await useCase.execute(makeInput());

      expect(accountRepository.findOrCreateDefaultForCurrency).toHaveBeenCalledWith(
        'user-1',
        'UZS',
      );
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'default-account-1', exchangeRateToDefault: '1' }),
      );
      expect(fxRateRepository.findRate).not.toHaveBeenCalled();
    });

    it('uses an explicitly-supplied accountId instead of the default', async () => {
      accountRepository.findById.mockResolvedValue(makeAccount({ id: 'explicit-account' }));

      await useCase.execute(makeInput({ accountId: 'explicit-account' }));

      expect(accountRepository.findById).toHaveBeenCalledWith('explicit-account');
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'explicit-account' }),
      );
    });

    it('looks up and stores the FX snapshot rate for a cross-currency expense (FR-FIN-027/029)', async () => {
      fxRateRepository.findRate.mockResolvedValue({
        rate: '12345.67',
        asOfDate: new Date('2026-01-15'),
        isApproximate: true,
      });

      await useCase.execute(
        makeInput({ currency: 'USD', transactionDate: new Date('2026-01-15') }),
      );

      expect(fxRateRepository.findRate).toHaveBeenCalledWith('USD', 'UZS', new Date('2026-01-15'));
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ exchangeRateToDefault: '12345.67' }),
      );
    });

    it('rejects creation when no exchange rate is available at all for a cross-currency pair (FR-FIN-043)', async () => {
      fxRateRepository.findRate.mockResolvedValue(null);

      await expect(useCase.execute(makeInput({ currency: 'USD' }))).rejects.toThrow(
        'No exchange rate available',
      );
      expect(transactionRepository.create).not.toHaveBeenCalled();
    });
  });
});

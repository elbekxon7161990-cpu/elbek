import type {
  Account,
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  FxRateRepository,
  TransactionRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidTransactionError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { type CreateIncomeInput, CreateIncomeUseCase } from './create-income.use-case';

function makeUser(): User {
  return { id: 'user-1', defaultCurrency: 'UZS' } as User;
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

function makeInput(overrides: Partial<CreateIncomeInput> = {}): CreateIncomeInput {
  return {
    userId: 'user-1',
    transactionType: 'INCOME',
    amount: '200000',
    currency: 'UZS',
    categoryId: 'category-freelance',
    transactionDate: new Date('2026-01-15'),
    description: 'Client payment',
    originalText: 'got 200000 from a client',
    sourceType: 'text',
    createdBy: 'ai',
    ...overrides,
  };
}

describe('CreateIncomeUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: { findById: ReturnType<typeof vi.fn> };
  let transactionRepository: { create: ReturnType<typeof vi.fn> };
  let accountRepository: {
    findById: ReturnType<typeof vi.fn>;
    findOrCreateDefaultForCurrency: ReturnType<typeof vi.fn>;
  };
  let fxRateRepository: { findRate: ReturnType<typeof vi.fn> };
  let useCase: CreateIncomeUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = {
      findById: vi.fn().mockResolvedValue({ id: 'category-freelance', status: 'active' }),
    };
    transactionRepository = {
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'txn-1', ...data })),
    };
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

    useCase = new CreateIncomeUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository as unknown as CategoryRepository,
      transactionRepository as unknown as TransactionRepository,
      accountRepository as unknown as AccountRepository,
      fxRateRepository as unknown as FxRateRepository,
    );
  });

  it('creates a normal INCOME transaction (FR-INC-001)', async () => {
    const result = await useCase.execute(makeInput());

    expect(result).toMatchObject({ transactionType: 'INCOME' });
  });

  it('creates a SALARY transaction and preserves the recurrence hint (FR-INC-002)', async () => {
    await useCase.execute(
      makeInput({
        transactionType: 'SALARY',
        isRecurringDetected: true,
        description: 'Monthly salary',
      }),
    );

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: 'SALARY', isRecurringDetected: true }),
    );
  });

  it('creates a REFUND transaction distinguishable via linkedTransactionId (FR-INC-003)', async () => {
    const result = await useCase.execute(
      makeInput({
        transactionType: 'REFUND',
        linkedTransactionId: 'txn-original',
        description: 'Shoe refund',
      }),
    );

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: 'REFUND', linkedTransactionId: 'txn-original' }),
    );
    expect(result).toMatchObject({ linkedTransactionId: 'txn-original' });
  });

  it('creates a REFUND transaction without a link, still distinguishable by type alone', async () => {
    await useCase.execute(makeInput({ transactionType: 'REFUND', description: 'Unlinked refund' }));

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: 'REFUND' }),
    );
    const [call] = transactionRepository.create.mock.calls[0] as [{ linkedTransactionId?: string }];
    expect(call.linkedTransactionId).toBeUndefined();
  });

  it('rejects an invalid amount (same validation rigor as expense, FR-INC-001)', async () => {
    await expect(useCase.execute(makeInput({ amount: '0' }))).rejects.toThrow(
      InvalidTransactionError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported currency (BR-INC-002)', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput({ currency: 'XYZ' }))).rejects.toThrow(
      InvalidCurrencyError,
    );
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  describe('TASK-FIN-007 Stage E — account linkage and FX snapshot', () => {
    it('resolves the implicit default account and exchangeRateToDefault "1" for a same-currency income (FR-FIN-023/027)', async () => {
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

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'explicit-account' }),
      );
    });

    it('looks up and stores the FX snapshot rate for a cross-currency income (FR-FIN-027/029)', async () => {
      fxRateRepository.findRate.mockResolvedValue({
        rate: '12345.67',
        asOfDate: new Date('2026-01-15'),
        isApproximate: false,
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

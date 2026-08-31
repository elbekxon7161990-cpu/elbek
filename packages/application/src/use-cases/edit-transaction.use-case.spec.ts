import type {
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  TransactionAuditLogRepository,
  TransactionProps,
  TransactionRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidTransactionError, Transaction } from '@afa/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditTransactionInput } from '../dto/edit-transaction.input';
import { AccountNotFoundError } from '../errors/account-not-found.error';
import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { InvalidDestinationAmountEditError } from '../errors/invalid-destination-amount-edit.error';
import { MissingDestinationAmountError } from '../errors/missing-destination-amount.error';
import { TransactionAlreadyDeletedError } from '../errors/transaction-already-deleted.error';
import { TransactionNotFoundError } from '../errors/transaction-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { UnauthorizedTransactionAccessError } from '../errors/unauthorized-transaction-access.error';
import { EditTransactionUseCase } from './edit-transaction.use-case';

const FIXED_NOW = new Date('2026-01-20T12:00:00Z');

function makeTransaction(
  overrides: Partial<TransactionProps> = {},
  now: Date = FIXED_NOW,
): Transaction {
  return new Transaction(
    {
      id: 'txn-1',
      userId: 'user-1',
      transactionType: 'EXPENSE',
      amount: '45000',
      currency: 'UZS',
      exchangeRateToDefault: null,
      accountId: null,
      sourceAccountId: null,
      destinationAccountId: null,
      destinationAmount: null,
      goalId: null,
      categoryId: 'category-food',
      subcategoryId: null,
      merchant: null,
      paymentMethod: null,
      transactionDate: new Date('2026-01-15'),
      transactionTime: null,
      location: null,
      tags: [],
      description: 'Lunch',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
      sourceReference: null,
      confidenceScores: null,
      isRecurringDetected: false,
      linkedTransactionId: null,
      createdBy: 'ai',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    now,
  );
}

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

function makeTransferTransaction(overrides: Partial<TransactionProps> = {}): Transaction {
  return makeTransaction({
    transactionType: 'TRANSFER',
    accountId: null,
    sourceAccountId: 'account-cash',
    destinationAccountId: 'account-bank',
    ...overrides,
  });
}

function makeAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'account-bank', userId: 'user-1', currency: 'UZS', isDeleted: false, ...overrides };
}

function makeInput(overrides: Partial<EditTransactionInput> = {}): EditTransactionInput {
  return {
    transactionId: 'txn-1',
    userId: 'user-1',
    changes: { amount: '50000' },
    ...overrides,
  };
}

describe('EditTransactionUseCase', () => {
  let transactionRepository: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: { findById: ReturnType<typeof vi.fn> };
  let auditLogRepository: { record: ReturnType<typeof vi.fn> };
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let accountRepository: { findById: ReturnType<typeof vi.fn> };
  let useCase: EditTransactionUseCase;

  beforeEach(() => {
    transactionRepository = {
      findById: vi.fn().mockResolvedValue(makeTransaction()),
      // The repository mock reconstructs a plausible return value — real
      // validation already happened in the use case before `.update()` was
      // called, so this reconstruction uses a far-future reference date
      // purely so it never spuriously re-rejects a date the use case
      // already accepted (the mock has no access to the user's timezone,
      // unlike the use case's own, already-verified BR-EXP-002 check).
      update: vi
        .fn()
        .mockImplementation((id, changes) =>
          Promise.resolve(makeTransaction({ ...changes, id }, new Date('2999-01-01T00:00:00Z'))),
        ),
    };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = {
      findById: vi.fn().mockResolvedValue({ id: 'category-food', status: 'active' }),
    };
    auditLogRepository = { record: vi.fn().mockResolvedValue(undefined) };
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    accountRepository = { findById: vi.fn().mockResolvedValue(makeAccount()) };

    useCase = new EditTransactionUseCase(
      transactionRepository as unknown as TransactionRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository as unknown as CategoryRepository,
      auditLogRepository as unknown as TransactionAuditLogRepository,
      userRepository as unknown as UserRepository,
      accountRepository as unknown as AccountRepository,
    );
  });

  it('edits the amount (AC-EXP-002)', async () => {
    const result = await useCase.execute(makeInput({ changes: { amount: '50000' } }));

    expect(transactionRepository.update).toHaveBeenCalledWith('txn-1', { amount: '50000' });
    expect(result).toMatchObject({ amount: '50000' });
  });

  it('edits multiple fields at once', async () => {
    const changes = { amount: '50000', description: 'Dinner', merchant: 'Cafe X' };

    await useCase.execute(makeInput({ changes }));

    expect(transactionRepository.update).toHaveBeenCalledWith('txn-1', changes);
  });

  it('throws when the transaction does not exist', async () => {
    transactionRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(TransactionNotFoundError);
    expect(transactionRepository.update).not.toHaveBeenCalled();
  });

  it('throws when the transaction belongs to a different user', async () => {
    transactionRepository.findById.mockResolvedValue(makeTransaction({ userId: 'someone-else' }));

    await expect(useCase.execute(makeInput())).rejects.toThrow(UnauthorizedTransactionAccessError);
    expect(transactionRepository.update).not.toHaveBeenCalled();
  });

  it('throws when editing an already-deleted transaction', async () => {
    transactionRepository.findById.mockResolvedValue(makeTransaction({ deletedAt: FIXED_NOW }));

    await expect(useCase.execute(makeInput())).rejects.toThrow(TransactionAlreadyDeletedError);
    expect(transactionRepository.update).not.toHaveBeenCalled();
  });

  it('rejects an edit that would make the amount invalid', async () => {
    await expect(useCase.execute(makeInput({ changes: { amount: '-5' } }))).rejects.toThrow(
      InvalidTransactionError,
    );
    expect(transactionRepository.update).not.toHaveBeenCalled();
  });

  it('rejects an edit to an unsupported currency', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput({ changes: { currency: 'XYZ' } }))).rejects.toThrow(
      InvalidCurrencyError,
    );
  });

  it('generates an audit entry per changed field (FR-EXP-007)', async () => {
    await useCase.execute(makeInput({ changes: { amount: '50000', description: 'Dinner' } }));

    expect(auditLogRepository.record).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: 'txn-1',
          fieldName: 'amount',
          oldValue: '45000',
          newValue: '50000',
        }),
        expect.objectContaining({
          transactionId: 'txn-1',
          fieldName: 'description',
          oldValue: 'Lunch',
          newValue: 'Dinner',
        }),
      ]),
    );
    const [entries] = auditLogRepository.record.mock.calls[0] as [unknown[]];
    expect(entries).toHaveLength(2);
  });

  it('does not generate an audit entry for a field passed with its own current value', async () => {
    await useCase.execute(makeInput({ changes: { amount: '45000', description: 'Dinner' } }));

    const [entries] = auditLogRepository.record.mock.calls[0] as [{ fieldName: string }[]];
    expect(entries.map((entry) => entry.fieldName)).toEqual(['description']);
  });

  it('does not call the audit repository at all when nothing actually changed', async () => {
    await useCase.execute(makeInput({ changes: { amount: '45000' } }));

    expect(auditLogRepository.record).not.toHaveBeenCalled();
  });

  describe('BR-EXP-002 — user-timezone-aware future-date validation on edit', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not look up the user when transactionDate is not among the changes', async () => {
      await useCase.execute(makeInput({ changes: { amount: '50000' } }));

      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('accepts an edited date that is today in the user’s timezone even though it is tomorrow in UTC', async () => {
      userRepository.findById.mockResolvedValue(makeUser({ timezone: 'Asia/Tashkent' })); // UTC+5
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-20T20:00:00Z')); // 01:00 on the 21st in Asia/Tashkent

      await expect(
        useCase.execute(makeInput({ changes: { transactionDate: new Date('2026-01-21') } })),
      ).resolves.toBeDefined();
    });

    it('rejects an edited date that is still in the future in the user’s timezone', async () => {
      userRepository.findById.mockResolvedValue(makeUser({ timezone: 'Asia/Tashkent' }));
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-20T20:00:00Z')); // local date is 2026-01-21

      await expect(
        useCase.execute(makeInput({ changes: { transactionDate: new Date('2026-01-22') } })),
      ).rejects.toThrow(InvalidTransactionError);
    });
  });

  describe('TASK-FIN-004 (FR-FIN-006) — TRANSFER edit', () => {
    beforeEach(() => {
      // The generic EXPENSE-shaped reconstruction the outer beforeEach wires
      // up would fail domain validation for a TRANSFER (e.g. a non-null
      // destinationAmount is rejected on a non-TRANSFER type) — reconstruct
      // as a TRANSFER instead, matching what `existing` actually was.
      transactionRepository.update.mockImplementation((id: string, changes: object) =>
        Promise.resolve(makeTransferTransaction({ ...changes, id })),
      );
    });

    it('edits the amount on a same-currency TRANSFER without requiring destinationAmount', async () => {
      transactionRepository.findById.mockResolvedValue(makeTransferTransaction());

      const result = await useCase.execute(makeInput({ changes: { amount: '50000' } }));

      expect(transactionRepository.update).toHaveBeenCalledWith('txn-1', { amount: '50000' });
      expect(result).toBeDefined();
    });

    it('edits the amount on a cross-currency TRANSFER when destinationAmount is supplied in the same edit', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ currency: 'USD', destinationAmount: '4.10' }),
      );
      accountRepository.findById.mockResolvedValue(makeAccount({ currency: 'UZS' }));

      await useCase.execute(makeInput({ changes: { amount: '55', destinationAmount: '4.50' } }));

      expect(transactionRepository.update).toHaveBeenCalledWith('txn-1', {
        amount: '55',
        destinationAmount: '4.50',
      });
    });

    it('rejects an amount edit on a cross-currency TRANSFER when destinationAmount is not supplied', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ currency: 'USD', destinationAmount: '4.10' }),
      );
      accountRepository.findById.mockResolvedValue(makeAccount({ currency: 'UZS' }));

      await expect(useCase.execute(makeInput({ changes: { amount: '55' } }))).rejects.toThrow(
        MissingDestinationAmountError,
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a currency edit that would make a same-currency TRANSFER cross-currency without a supplied destinationAmount', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ currency: 'UZS' }),
      );
      accountRepository.findById.mockResolvedValue(makeAccount({ currency: 'UZS' }));

      await expect(useCase.execute(makeInput({ changes: { currency: 'USD' } }))).rejects.toThrow(
        MissingDestinationAmountError,
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a currency edit that would make a cross-currency TRANSFER same-currency without explicitly clearing destinationAmount', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ currency: 'USD', destinationAmount: '4.10' }),
      );
      accountRepository.findById.mockResolvedValue(makeAccount({ currency: 'UZS' }));

      await expect(useCase.execute(makeInput({ changes: { currency: 'UZS' } }))).rejects.toThrow(
        InvalidDestinationAmountEditError,
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });

    it('accepts a currency edit that makes a cross-currency TRANSFER same-currency when destinationAmount is explicitly cleared', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ currency: 'USD', destinationAmount: '4.10' }),
      );
      accountRepository.findById.mockResolvedValue(makeAccount({ currency: 'UZS' }));

      await useCase.execute(makeInput({ changes: { currency: 'UZS', destinationAmount: null } }));

      expect(transactionRepository.update).toHaveBeenCalledWith('txn-1', {
        currency: 'UZS',
        destinationAmount: null,
      });
    });

    it('rejects editing destinationAmount without also editing amount or currency', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ currency: 'USD', destinationAmount: '4.10' }),
      );

      await expect(
        useCase.execute(makeInput({ changes: { destinationAmount: '5.00' } })),
      ).rejects.toThrow(InvalidTransactionError);
      expect(transactionRepository.update).not.toHaveBeenCalled();
      expect(accountRepository.findById).not.toHaveBeenCalled();
    });

    it('rejects editing a goal-linked TRANSFER', async () => {
      transactionRepository.findById.mockResolvedValue(
        makeTransferTransaction({ goalId: 'goal-1' }),
      );

      await expect(useCase.execute(makeInput({ changes: { amount: '50000' } }))).rejects.toThrow(
        InvalidTransactionError,
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });

    it('does not consult AccountRepository for a metadata-only TRANSFER edit (no amount/currency/destinationAmount touched)', async () => {
      transactionRepository.findById.mockResolvedValue(makeTransferTransaction());

      await useCase.execute(makeInput({ changes: { description: 'Corrected note' } }));

      expect(accountRepository.findById).not.toHaveBeenCalled();
    });

    it('throws AccountNotFoundError when the destination account cannot be found', async () => {
      transactionRepository.findById.mockResolvedValue(makeTransferTransaction());
      accountRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(makeInput({ changes: { amount: '50000' } }))).rejects.toThrow(
        AccountNotFoundError,
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedAccountAccessError when the destination account belongs to a different user', async () => {
      transactionRepository.findById.mockResolvedValue(makeTransferTransaction());
      accountRepository.findById.mockResolvedValue(makeAccount({ userId: 'user-2' }));

      await expect(useCase.execute(makeInput({ changes: { amount: '50000' } }))).rejects.toThrow(
        UnauthorizedAccountAccessError,
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });
  });
});

import type {
  TransactionAuditLogRepository,
  TransactionProps,
  TransactionRepository,
} from '@afa/domain';
import { Transaction } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionNotDeletedError } from '../errors/transaction-not-deleted.error';
import { TransactionNotFoundError } from '../errors/transaction-not-found.error';
import { UnauthorizedTransactionAccessError } from '../errors/unauthorized-transaction-access.error';
import { RestoreTransactionUseCase } from './restore-transaction.use-case';

const FIXED_NOW = new Date('2026-01-20T12:00:00Z');
const DELETED_AT = new Date('2026-01-19T09:00:00Z');

function makeTransaction(overrides: Partial<TransactionProps> = {}): Transaction {
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
      merchant: 'Cafe X',
      paymentMethod: 'cash',
      transactionDate: new Date('2026-01-15'),
      transactionTime: null,
      location: null,
      tags: ['lunch'],
      description: 'Lunch',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
      sourceReference: null,
      confidenceScores: null,
      isRecurringDetected: false,
      linkedTransactionId: null,
      createdBy: 'ai',
      deletedAt: DELETED_AT,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      ...overrides,
    },
    FIXED_NOW,
  );
}

describe('RestoreTransactionUseCase', () => {
  let transactionRepository: {
    findById: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  let auditLogRepository: { record: ReturnType<typeof vi.fn> };
  let useCase: RestoreTransactionUseCase;

  beforeEach(() => {
    transactionRepository = {
      findById: vi.fn().mockResolvedValue(makeTransaction()),
      restore: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(makeTransaction({ id, deletedAt: null })),
        ),
    };
    auditLogRepository = { record: vi.fn().mockResolvedValue(undefined) };

    useCase = new RestoreTransactionUseCase(
      transactionRepository as unknown as TransactionRepository,
      auditLogRepository as unknown as TransactionAuditLogRepository,
    );
  });

  it('restores a deleted transaction (AC-EXP-003)', async () => {
    const result = await useCase.execute({ transactionId: 'txn-1', userId: 'user-1' });

    expect(transactionRepository.restore).toHaveBeenCalledWith('txn-1');
    expect(result.isDeleted).toBe(false);
    expect(auditLogRepository.record).toHaveBeenCalledWith([
      expect.objectContaining({
        transactionId: 'txn-1',
        fieldName: 'deleted_at',
        oldValue: DELETED_AT.toISOString(),
        newValue: null,
        changedBy: 'undo',
      }),
    ]);
  });

  it('rejects restoring a transaction that is not deleted', async () => {
    transactionRepository.findById.mockResolvedValue(makeTransaction({ deletedAt: null }));

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      TransactionNotDeletedError,
    );
    expect(transactionRepository.restore).not.toHaveBeenCalled();
  });

  it('throws when the transaction does not exist', async () => {
    transactionRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute({ transactionId: 'missing', userId: 'user-1' })).rejects.toThrow(
      TransactionNotFoundError,
    );
    expect(transactionRepository.restore).not.toHaveBeenCalled();
  });

  it('throws when the transaction belongs to a different user', async () => {
    transactionRepository.findById.mockResolvedValue(makeTransaction({ userId: 'someone-else' }));

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      UnauthorizedTransactionAccessError,
    );
    expect(transactionRepository.restore).not.toHaveBeenCalled();
  });

  it('TASK-FIN-013 — treats a concurrent-race null from restore() the same as not-deleted, never records a duplicate audit entry', async () => {
    transactionRepository.restore.mockResolvedValue(null);

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      TransactionNotDeletedError,
    );
    expect(auditLogRepository.record).not.toHaveBeenCalled();
  });

  it('restores with all original field values intact (AC-EXP-003)', async () => {
    const original = makeTransaction();
    transactionRepository.findById.mockResolvedValue(original);
    transactionRepository.restore.mockResolvedValue(makeTransaction({ deletedAt: null }));

    const result = await useCase.execute({ transactionId: 'txn-1', userId: 'user-1' });

    expect(result.amount).toBe(original.amount);
    expect(result.description).toBe(original.description);
    expect(result.merchant).toBe(original.merchant);
    expect(result.paymentMethod).toBe(original.paymentMethod);
    expect(result.tags).toEqual(original.tags);
    expect(result.categoryId).toBe(original.categoryId);
  });
});

import type {
  TransactionAuditLogRepository,
  TransactionProps,
  TransactionRepository,
} from '@afa/domain';
import { Transaction } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalLinkedTransferDeleteNotSupportedError } from '../errors/goal-linked-transfer-delete-not-supported.error';
import { TransactionAlreadyDeletedError } from '../errors/transaction-already-deleted.error';
import { TransactionNotFoundError } from '../errors/transaction-not-found.error';
import { UnauthorizedTransactionAccessError } from '../errors/unauthorized-transaction-access.error';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';

const FIXED_NOW = new Date('2026-01-20T12:00:00Z');

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
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      ...overrides,
    },
    FIXED_NOW,
  );
}

describe('DeleteTransactionUseCase', () => {
  let transactionRepository: {
    findById: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  let auditLogRepository: { record: ReturnType<typeof vi.fn> };
  let useCase: DeleteTransactionUseCase;

  beforeEach(() => {
    transactionRepository = {
      findById: vi.fn().mockResolvedValue(makeTransaction()),
      softDelete: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(makeTransaction({ id, deletedAt: FIXED_NOW })),
        ),
    };
    auditLogRepository = { record: vi.fn().mockResolvedValue(undefined) };

    useCase = new DeleteTransactionUseCase(
      transactionRepository as unknown as TransactionRepository,
      auditLogRepository as unknown as TransactionAuditLogRepository,
    );
  });

  it('soft-deletes a transaction (FR-EXP-006)', async () => {
    const result = await useCase.execute({ transactionId: 'txn-1', userId: 'user-1' });

    expect(transactionRepository.softDelete).toHaveBeenCalledWith('txn-1');
    expect(result.isDeleted).toBe(true);
    expect(auditLogRepository.record).toHaveBeenCalledWith([
      expect.objectContaining({
        transactionId: 'txn-1',
        fieldName: 'deleted_at',
        oldValue: null,
        changedBy: 'user_edit',
      }),
    ]);
  });

  it('throws when the transaction does not exist', async () => {
    transactionRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute({ transactionId: 'missing', userId: 'user-1' })).rejects.toThrow(
      TransactionNotFoundError,
    );
    expect(transactionRepository.softDelete).not.toHaveBeenCalled();
  });

  it('throws when the transaction belongs to a different user', async () => {
    transactionRepository.findById.mockResolvedValue(makeTransaction({ userId: 'someone-else' }));

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      UnauthorizedTransactionAccessError,
    );
    expect(transactionRepository.softDelete).not.toHaveBeenCalled();
  });

  it('rejects a double delete', async () => {
    transactionRepository.findById.mockResolvedValue(makeTransaction({ deletedAt: FIXED_NOW }));

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      TransactionAlreadyDeletedError,
    );
    expect(transactionRepository.softDelete).not.toHaveBeenCalled();
  });

  it('TASK-BOT-007-FIX — treats a null softDelete result (the atomic write lost a genuine race) as already-deleted, and never records a redundant audit entry', async () => {
    // The pre-check (findById/isDeleted) is racily stale here on purpose —
    // it still reports not-yet-deleted, exactly matching what a genuinely
    // concurrent caller would observe — but the atomic softDelete write
    // itself is what actually reports the loss.
    transactionRepository.softDelete.mockResolvedValue(null);

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      TransactionAlreadyDeletedError,
    );
    expect(transactionRepository.softDelete).toHaveBeenCalledWith('txn-1');
    expect(auditLogRepository.record).not.toHaveBeenCalled();
  });

  it('TASK-FIN-004 (FR-FIN-006) — rejects deleting a goal-linked TRANSFER', async () => {
    transactionRepository.findById.mockResolvedValue(
      makeTransaction({
        transactionType: 'TRANSFER',
        accountId: null,
        sourceAccountId: 'account-cash',
        destinationAccountId: 'account-bank',
        goalId: 'goal-1',
      }),
    );

    await expect(useCase.execute({ transactionId: 'txn-1', userId: 'user-1' })).rejects.toThrow(
      GoalLinkedTransferDeleteNotSupportedError,
    );
    expect(transactionRepository.softDelete).not.toHaveBeenCalled();
  });

  it('TASK-FIN-004 (FR-FIN-006) — still allows deleting a non-goal-linked TRANSFER', async () => {
    transactionRepository.findById.mockResolvedValue(
      makeTransaction({
        transactionType: 'TRANSFER',
        accountId: null,
        sourceAccountId: 'account-cash',
        destinationAccountId: 'account-bank',
        goalId: null,
      }),
    );

    const result = await useCase.execute({ transactionId: 'txn-1', userId: 'user-1' });

    expect(transactionRepository.softDelete).toHaveBeenCalledWith('txn-1');
    expect(result.isDeleted).toBe(true);
  });
});

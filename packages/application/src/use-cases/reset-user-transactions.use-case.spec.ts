import type {
  AuditLogRepository,
  TransactionAuditLogRepository,
  TransactionProps,
  TransactionRepository,
} from '@afa/domain';
import { Transaction } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetUserTransactionsUseCase } from './reset-user-transactions.use-case';

const FIXED_NOW = new Date('2026-01-20T12:00:00Z');
const USER_ID = 'user-1';
const ADMIN_ID = 'admin-1';

function makeTransaction(overrides: Partial<TransactionProps> = {}): Transaction {
  return new Transaction(
    {
      id: 'txn-1',
      userId: USER_ID,
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

describe('ResetUserTransactionsUseCase', () => {
  let transactionRepository: {
    findByUserId: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  let transactionAuditLogRepository: { record: ReturnType<typeof vi.fn> };
  let auditLogRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: ResetUserTransactionsUseCase;

  beforeEach(() => {
    transactionRepository = {
      findByUserId: vi
        .fn()
        .mockResolvedValue([makeTransaction({ id: 'txn-1' }), makeTransaction({ id: 'txn-2' })]),
      softDelete: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(makeTransaction({ id, deletedAt: FIXED_NOW })),
        ),
    };
    transactionAuditLogRepository = { record: vi.fn().mockResolvedValue(undefined) };
    auditLogRepository = { create: vi.fn().mockResolvedValue({}) };

    useCase = new ResetUserTransactionsUseCase(
      transactionRepository as unknown as TransactionRepository,
      transactionAuditLogRepository as unknown as TransactionAuditLogRepository,
      auditLogRepository as unknown as AuditLogRepository,
    );
  });

  it('soft-deletes every active transaction and reports the count', async () => {
    const result = await useCase.execute(USER_ID, 'requested by user', ADMIN_ID);

    expect(transactionRepository.softDelete).toHaveBeenCalledWith('txn-1');
    expect(transactionRepository.softDelete).toHaveBeenCalledWith('txn-2');
    expect(result).toEqual({ deletedCount: 2 });
  });

  it('records a transaction_audit_log entry per deleted transaction, changedBy "api"', async () => {
    await useCase.execute(USER_ID, 'requested by user', ADMIN_ID);

    expect(transactionAuditLogRepository.record).toHaveBeenCalledWith([
      expect.objectContaining({
        transactionId: 'txn-1',
        fieldName: 'deleted_at',
        changedBy: 'api',
      }),
      expect.objectContaining({
        transactionId: 'txn-2',
        fieldName: 'deleted_at',
        changedBy: 'api',
      }),
    ]);
  });

  it('writes one summary entry to the generic admin audit log', async () => {
    await useCase.execute(USER_ID, 'requested by user', ADMIN_ID);

    expect(auditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorId: ADMIN_ID,
        action: 'user.reset_transactions',
        targetUserId: USER_ID,
        justification: 'requested by user',
        metadata: { deletedCount: 2 },
      }),
    );
  });

  it("force-deletes a goal-linked TRANSFER (bypasses DeleteTransactionUseCase's own guard, by design)", async () => {
    transactionRepository.findByUserId.mockResolvedValue([
      makeTransaction({
        id: 'txn-goal',
        transactionType: 'TRANSFER',
        sourceAccountId: 'account-cash',
        destinationAccountId: 'account-bank',
        goalId: 'goal-1',
      }),
    ]);

    const result = await useCase.execute(USER_ID, 'reason', ADMIN_ID);

    expect(transactionRepository.softDelete).toHaveBeenCalledWith('txn-goal');
    expect(result).toEqual({ deletedCount: 1 });
  });

  it('returns zero and writes no transaction_audit_log entries when there is nothing to delete', async () => {
    transactionRepository.findByUserId.mockResolvedValue([]);

    const result = await useCase.execute(USER_ID, 'reason', ADMIN_ID);

    expect(result).toEqual({ deletedCount: 0 });
    expect(transactionAuditLogRepository.record).not.toHaveBeenCalled();
    // Still writes the summary admin audit entry, even for a zero-effect run.
    expect(auditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { deletedCount: 0 } }),
    );
  });

  it('never counts a transaction whose softDelete lost a genuine concurrent race (returns null)', async () => {
    transactionRepository.softDelete.mockImplementation((id: string) =>
      Promise.resolve(id === 'txn-1' ? null : makeTransaction({ id, deletedAt: FIXED_NOW })),
    );

    const result = await useCase.execute(USER_ID, 'reason', ADMIN_ID);

    expect(result).toEqual({ deletedCount: 1 });
    expect(transactionAuditLogRepository.record).toHaveBeenCalledWith([
      expect.objectContaining({ transactionId: 'txn-2' }),
    ]);
  });
});

import type { TransactionProps } from '@afa/domain';
import { Transaction } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import { RestoreTransactionUseCase } from './restore-transaction.use-case';
import { UndoLastTransactionActionUseCase } from './undo-last-transaction-action.use-case';

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
      merchant: 'Cafe X',
      paymentMethod: 'cash',
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

describe('UndoLastTransactionActionUseCase (TASK-FIN-013, FR-UND-001/002)', () => {
  let transactionRepository: { findMostRecentByUserId: ReturnType<typeof vi.fn> };
  let deleteTransaction: { execute: ReturnType<typeof vi.fn> };
  let restoreTransaction: { execute: ReturnType<typeof vi.fn> };
  let useCase: UndoLastTransactionActionUseCase;

  beforeEach(() => {
    transactionRepository = { findMostRecentByUserId: vi.fn() };
    deleteTransaction = { execute: vi.fn() };
    restoreTransaction = { execute: vi.fn() };
    useCase = new UndoLastTransactionActionUseCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transactionRepository as any,
      deleteTransaction as unknown as DeleteTransactionUseCase,
      restoreTransaction as unknown as RestoreTransactionUseCase,
    );
  });

  it('nothing_to_undo when the user has no transactions at all', async () => {
    transactionRepository.findMostRecentByUserId.mockResolvedValue(null);

    const outcome = await useCase.execute('user-1');

    expect(outcome).toEqual({ kind: 'nothing_to_undo' });
    expect(deleteTransaction.execute).not.toHaveBeenCalled();
    expect(restoreTransaction.execute).not.toHaveBeenCalled();
  });

  it('last action = delete → calls the existing RestoreTransactionUseCase unchanged (happy path)', async () => {
    const deletedTxn = makeTransaction({ deletedAt: new Date('2026-01-19') });
    transactionRepository.findMostRecentByUserId.mockResolvedValue(deletedTxn);
    const restored = makeTransaction({ deletedAt: null });
    restoreTransaction.execute.mockResolvedValue(restored);

    const outcome = await useCase.execute('user-1');

    expect(restoreTransaction.execute).toHaveBeenCalledWith({ transactionId: 'txn-1', userId: 'user-1' });
    expect(deleteTransaction.execute).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'undone', action: 'deleted', transaction: restored });
  });

  it("last action = create (never edited since) → calls the existing DeleteTransactionUseCase with actor 'undo' (happy path)", async () => {
    const freshTxn = makeTransaction({ createdAt: FIXED_NOW, updatedAt: FIXED_NOW, deletedAt: null });
    transactionRepository.findMostRecentByUserId.mockResolvedValue(freshTxn);
    const deleted = makeTransaction({ deletedAt: FIXED_NOW });
    deleteTransaction.execute.mockResolvedValue(deleted);

    const outcome = await useCase.execute('user-1');

    expect(deleteTransaction.execute).toHaveBeenCalledWith({
      transactionId: 'txn-1',
      userId: 'user-1',
      actor: 'undo',
    });
    expect(restoreTransaction.execute).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'undone', action: 'created', transaction: deleted });
  });

  it('last action = edit (updatedAt after createdAt, still active) → unsupported_action, never deletes the legitimately-edited transaction', async () => {
    const editedTxn = makeTransaction({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      updatedAt: new Date('2026-01-15T00:00:00Z'),
      deletedAt: null,
    });
    transactionRepository.findMostRecentByUserId.mockResolvedValue(editedTxn);

    const outcome = await useCase.execute('user-1');

    expect(outcome).toEqual({ kind: 'unsupported_action' });
    expect(deleteTransaction.execute).not.toHaveBeenCalled();
    expect(restoreTransaction.execute).not.toHaveBeenCalled();
  });

  it('user isolation: the exact userId given is passed straight through to the finder and to whichever use case is called', async () => {
    const deletedTxn = makeTransaction({ userId: 'user-abc-123', deletedAt: new Date('2026-01-19') });
    transactionRepository.findMostRecentByUserId.mockResolvedValue(deletedTxn);
    restoreTransaction.execute.mockResolvedValue(deletedTxn);

    await useCase.execute('user-abc-123');

    expect(transactionRepository.findMostRecentByUserId).toHaveBeenCalledWith('user-abc-123');
    expect(restoreTransaction.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-abc-123' }),
    );
  });

  it('FR-UND-002: re-resolves the pointer fresh on every call — two calls in a row act on two different "most recent" states, never a stale cached pointer', async () => {
    const deletedTxn = makeTransaction({ deletedAt: new Date('2026-01-19') });
    // Never edited since creation (createdAt === updatedAt) — the second
    // call's own fresh read must treat this as "undo the create", not fall
    // through to unsupported_action.
    const freshlyTouchedTxn = makeTransaction({
      createdAt: new Date('2026-01-20T13:00:00Z'),
      updatedAt: new Date('2026-01-20T13:00:00Z'),
      deletedAt: null,
    });
    transactionRepository.findMostRecentByUserId
      .mockResolvedValueOnce(deletedTxn)
      .mockResolvedValueOnce(freshlyTouchedTxn);
    restoreTransaction.execute.mockResolvedValue(makeTransaction({ deletedAt: null }));
    deleteTransaction.execute.mockResolvedValue(makeTransaction({ deletedAt: new Date() }));

    const first = await useCase.execute('user-1');
    const second = await useCase.execute('user-1');

    expect(first.kind).toBe('undone');
    expect(transactionRepository.findMostRecentByUserId).toHaveBeenCalledTimes(2);
    // Second call resolved a DIFFERENT (now-restored, freshly-touched)
    // transaction — since it was never edited since its own creation in
    // this fixture, it's treated as an "undo the create" case.
    expect(second.kind).toBe('undone');
    expect(deleteTransaction.execute).toHaveBeenCalledTimes(1);
  });

  it('propagates a RestoreTransactionUseCase error rather than swallowing it (the Telegram layer maps it to a safe reply)', async () => {
    const deletedTxn = makeTransaction({ deletedAt: new Date('2026-01-19') });
    transactionRepository.findMostRecentByUserId.mockResolvedValue(deletedTxn);
    restoreTransaction.execute.mockRejectedValue(new Error('P2028 db internal detail'));

    await expect(useCase.execute('user-1')).rejects.toThrow('P2028 db internal detail');
  });
});

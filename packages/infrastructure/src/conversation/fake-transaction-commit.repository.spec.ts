import { describe, expect, it } from 'vitest';
import type { TransactionExtractionCandidate } from '@afa/domain';

import { FakeTransactionCommitPort } from './fake-transaction-commit.repository';

function candidate(): TransactionExtractionCandidate {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-08-14',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
  };
}

describe('FakeTransactionCommitPort', () => {
  it('returns a distinct transactionId per commit call', async () => {
    const port = new FakeTransactionCommitPort();

    const first = await port.commit({
      userId: 'user-1',
      candidate: candidate(),
      draftId: 'draft-1',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
    });
    const second = await port.commit({
      userId: 'user-1',
      candidate: candidate(),
      draftId: 'draft-1',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
    });

    expect(first.transactionId).not.toBe(second.transactionId);
  });

  it('records every commit call for test assertions', async () => {
    const port = new FakeTransactionCommitPort();

    await port.commit({
      userId: 'user-1',
      candidate: candidate(),
      draftId: 'draft-1',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
    });

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]?.userId).toBe('user-1');
  });
});

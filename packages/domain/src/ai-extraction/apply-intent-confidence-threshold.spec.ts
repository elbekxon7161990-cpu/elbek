import { describe, expect, it } from 'vitest';

import { applyIntentConfidenceThreshold } from './apply-intent-confidence-threshold';
import type {
  StructuredExtractionOutput,
  TransactionExtractionCandidate,
} from './transaction-extraction-schema';

function candidate(
  overrides: Partial<TransactionExtractionCandidate> = {},
): TransactionExtractionCandidate {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-08-13',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: { intent: 0.95, amount: 0.9 },
    ...overrides,
  };
}

function output(
  transactions: TransactionExtractionCandidate[],
  overrides: Partial<StructuredExtractionOutput> = {},
): StructuredExtractionOutput {
  return {
    transactions,
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
    ...overrides,
  };
}

describe('applyIntentConfidenceThreshold (FR-AI-013)', () => {
  it('leaves a high-confidence candidate unchanged (AC-AI-001 path)', () => {
    const input = output([candidate({ confidenceScores: { intent: 0.98 } })]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result).toEqual(input);
  });

  it('downgrades a candidate below the default 0.6 threshold to UNKNOWN', () => {
    const input = output([candidate({ confidenceScores: { intent: 0.4 } })]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.transactions[0]?.intent).toBe('UNKNOWN');
  });

  it('nulls every conditionally-required field when downgrading, to stay schema-consistent', () => {
    const input = output([
      candidate({
        intent: 'DEBT_GIVEN',
        counterparty: 'Aziz',
        category: null,
        confidenceScores: { intent: 0.3 },
      }),
    ]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.transactions[0]).toMatchObject({
      intent: 'UNKNOWN',
      amount: null,
      currency: null,
      transactionDate: null,
      category: null,
      counterparty: null,
    });
  });

  it('preserves non-financial fields (description, tags) on downgrade', () => {
    const input = output([
      candidate({
        confidenceScores: { intent: 0.2 },
        description: 'Some transaction',
        tags: ['work'],
      }),
    ]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.transactions[0]?.description).toBe('Some transaction');
    expect(result.transactions[0]?.tags).toEqual(['work']);
  });

  it('treats a missing intent confidence score as failing the threshold (AI-P6 fail closed)', () => {
    const input = output([candidate({ confidenceScores: { amount: 0.9 } })]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.transactions[0]?.intent).toBe('UNKNOWN');
  });

  it('sets clarificationNeeded=true and a default question when a downgrade occurs and none was set', () => {
    const input = output([candidate({ confidenceScores: { intent: 0.1 } })]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationQuestion).not.toBeNull();
  });

  it('preserves an existing clarificationQuestion rather than overwriting it', () => {
    const input = output([candidate({ confidenceScores: { intent: 0.1 } })], {
      clarificationNeeded: true,
      clarificationQuestion: 'What category was that?',
    });
    const result = applyIntentConfidenceThreshold(input);

    expect(result.clarificationQuestion).toBe('What category was that?');
  });

  it('does not re-downgrade a candidate that is already UNKNOWN', () => {
    const input = output([
      candidate({
        intent: 'UNKNOWN',
        amount: null,
        currency: null,
        category: null,
        transactionDate: null,
        confidenceScores: { intent: 0.1 },
      }),
    ]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.transactions[0]?.intent).toBe('UNKNOWN');
  });

  it('respects a custom threshold', () => {
    const input = output([candidate({ confidenceScores: { intent: 0.7 } })]);
    const result = applyIntentConfidenceThreshold(input, 0.85);

    expect(result.transactions[0]?.intent).toBe('UNKNOWN');
  });

  it('handles multiple candidates independently (FR-AI-025 — compound messages)', () => {
    const input = output([
      candidate({ confidenceScores: { intent: 0.95 }, description: 'Lunch' }),
      candidate({ confidenceScores: { intent: 0.3 }, description: 'Coffee' }),
    ]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result.transactions[0]?.intent).toBe('EXPENSE');
    expect(result.transactions[1]?.intent).toBe('UNKNOWN');
  });

  it('is a no-op for an empty transactions array', () => {
    const input = output([]);
    const result = applyIntentConfidenceThreshold(input);

    expect(result).toEqual(input);
  });
});

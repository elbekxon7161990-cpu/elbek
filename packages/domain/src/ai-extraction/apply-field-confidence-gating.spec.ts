import { describe, expect, it } from 'vitest';

import { applyFieldConfidenceGating } from './apply-field-confidence-gating';
import type { TransactionExtractionCandidate } from './transaction-extraction-schema';

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
    confidenceScores: {
      intent: 0.95,
      amount: 0.9,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.9,
    },
    ...overrides,
  };
}

describe('applyFieldConfidenceGating (§4.6.1 Low band)', () => {
  it('leaves a high/medium-confidence field untouched', () => {
    const result = applyFieldConfidenceGating(candidate({ confidenceScores: { category: 0.7 } }));

    expect(result.gatedFields).toHaveLength(0);
    expect(result.candidate.category).toBe('FOOD_DINING');
  });

  it('nulls a field whose confidence is exactly at the Low/Medium boundary (0.6 is NOT Low, per §4.6.1)', () => {
    const result = applyFieldConfidenceGating(candidate({ confidenceScores: { category: 0.6 } }));

    expect(result.gatedFields).toHaveLength(0);
  });

  it('nulls a field whose confidence falls in the Low band (< 0.6)', () => {
    const result = applyFieldConfidenceGating(candidate({ confidenceScores: { category: 0.59 } }));

    expect(result.gatedFields).toEqual(['category']);
    expect(result.candidate.category).toBeNull();
  });

  it('does not gate a field with no reported confidence score at all', () => {
    const result = applyFieldConfidenceGating(
      candidate({ merchant: 'Korzinka', confidenceScores: {} }),
    );

    // No score reported is a schema-gap, not necessarily "Low" — the intent-specific
    // gate (FR-AI-013) and grounding (FR-AI-024) are what police merchant/etc.
    expect(result.gatedFields).not.toContain('merchant');
  });

  it('does not touch an already-null field', () => {
    const result = applyFieldConfidenceGating(
      candidate({ merchant: null, confidenceScores: { merchant: 0.1 } }),
    );

    expect(result.gatedFields).toHaveLength(0);
  });

  it('gates multiple low-confidence fields independently in one pass', () => {
    const result = applyFieldConfidenceGating(
      candidate({
        merchant: 'Korzinka',
        location: 'Chilonzor',
        confidenceScores: { category: 0.5, merchant: 0.4, location: 0.55 },
      }),
    );

    expect([...result.gatedFields].sort()).toEqual(['category', 'location', 'merchant']);
    expect(result.candidate.category).toBeNull();
    expect(result.candidate.merchant).toBeNull();
    expect(result.candidate.location).toBeNull();
  });

  it('never gates intent or description — those are governed by FR-AI-013 and always-required rules, not this layer', () => {
    const result = applyFieldConfidenceGating(candidate({ confidenceScores: { intent: 0.1 } }));

    expect(result.candidate.intent).toBe('EXPENSE');
    expect(result.candidate.description).toBe('Lunch');
  });

  it('is a pure no-op when every reported field confidence is High/Medium', () => {
    const original = candidate();
    const result = applyFieldConfidenceGating(original);

    expect(result.candidate).toEqual(original);
    expect(result.gatedFields).toHaveLength(0);
  });
});

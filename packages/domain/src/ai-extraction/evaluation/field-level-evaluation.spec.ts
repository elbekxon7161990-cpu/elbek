import { describe, expect, it } from 'vitest';

import { evaluateFields, summarizeFieldAccuracy } from './field-level-evaluation';
import type { GroundTruthCandidate } from './evaluation-dataset';
import type { TransactionExtractionCandidate } from '../transaction-extraction-schema';

function prediction(
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
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

function groundTruth(overrides: Partial<GroundTruthCandidate> = {}): GroundTruthCandidate {
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
    description: 'Lunch',
    ...overrides,
  };
}

describe('evaluateFields', () => {
  it('marks every field correct when prediction exactly matches ground truth', () => {
    const results = evaluateFields(prediction(), groundTruth());

    expect(results.every((r) => r.correct)).toBe(true);
  });

  it('treats a null prediction matching a null ground truth as correct, not automatically incorrect', () => {
    const results = evaluateFields(prediction({ merchant: null }), groundTruth({ merchant: null }));
    const merchantResult = results.find((r) => r.field === 'merchant');

    expect(merchantResult?.correct).toBe(true);
  });

  it('marks a null prediction incorrect when ground truth has a real value', () => {
    const results = evaluateFields(
      prediction({ merchant: null }),
      groundTruth({ merchant: 'Korzinka' }),
    );
    const merchantResult = results.find((r) => r.field === 'merchant');

    expect(merchantResult?.correct).toBe(false);
  });

  it('marks a non-null prediction incorrect when ground truth is null (a fabrication)', () => {
    const results = evaluateFields(
      prediction({ merchant: 'Cafe Somewhere' }),
      groundTruth({ merchant: null }),
    );
    const merchantResult = results.find((r) => r.field === 'merchant');

    expect(merchantResult?.correct).toBe(false);
  });

  it('is case-insensitive for string fields', () => {
    const results = evaluateFields(
      prediction({ category: 'food_dining' }),
      groundTruth({ category: 'FOOD_DINING' }),
    );
    const categoryResult = results.find((r) => r.field === 'category');

    expect(categoryResult?.correct).toBe(true);
  });

  it('flags an incorrect amount', () => {
    const results = evaluateFields(prediction({ amount: 50000 }), groundTruth({ amount: 45000 }));
    const amountResult = results.find((r) => r.field === 'amount');

    expect(amountResult?.correct).toBe(false);
  });

  it('reports the predicted confidence alongside each field result', () => {
    const results = evaluateFields(prediction(), groundTruth());
    const amountResult = results.find((r) => r.field === 'amount');

    expect(amountResult?.predictedConfidence).toBe(0.95);
  });

  it('reports null predicted confidence when the model reported none for that field', () => {
    const results = evaluateFields(prediction({ confidenceScores: {} }), groundTruth());
    const amountResult = results.find((r) => r.field === 'amount');

    expect(amountResult?.predictedConfidence).toBeNull();
  });
});

describe('summarizeFieldAccuracy', () => {
  it('computes per-field accuracy across multiple items', () => {
    const item1 = evaluateFields(prediction(), groundTruth());
    const item2 = evaluateFields(prediction({ amount: 999 }), groundTruth());

    const summary = summarizeFieldAccuracy([item1, item2]);

    expect(summary.amount.total).toBe(2);
    expect(summary.amount.correct).toBe(1);
    expect(summary.amount.accuracy).toBe(0.5);
    expect(summary.intent.accuracy).toBe(1);
  });

  it('handles an empty result set without dividing by zero', () => {
    const summary = summarizeFieldAccuracy([]);

    expect(summary.amount.total).toBe(0);
    expect(summary.amount.accuracy).toBe(0);
  });
});

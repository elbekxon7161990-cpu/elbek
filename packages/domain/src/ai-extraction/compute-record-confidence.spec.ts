import { describe, expect, it } from 'vitest';

import { classifyRecordConfidence, computeRecordConfidence } from './compute-record-confidence';
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
      intent: 0.98,
      amount: 0.95,
      currency: 0.9,
      category: 0.85,
      transactionDate: 0.97,
    },
    ...overrides,
  };
}

describe('computeRecordConfidence (§4.6.2)', () => {
  it('takes the minimum of required-field confidences, not the average', () => {
    const c = candidate({
      confidenceScores: {
        intent: 0.99,
        amount: 0.99,
        currency: 0.99,
        category: 0.5,
        transactionDate: 0.99,
      },
    });

    // If this were an average it would be well above 0.85; the min (category=0.5) must win.
    expect(computeRecordConfidence(c)).toBe(0.5);
  });

  it('only includes amount/currency/transactionDate for financial intents (a non-financial intent needs only its own intent score)', () => {
    const c = candidate({
      intent: 'SMALL_TALK',
      amount: null,
      currency: null,
      category: null,
      transactionDate: null,
      confidenceScores: { intent: 0.95 },
    });

    expect(computeRecordConfidence(c)).toBe(0.95);
  });

  it('does not require category for an intent outside EXPENSE/INCOME/SALARY/REFUND (e.g. DEBT_GIVEN)', () => {
    const c = candidate({
      intent: 'DEBT_GIVEN',
      category: null,
      counterparty: 'Aziz',
      confidenceScores: {
        intent: 0.9,
        amount: 0.9,
        currency: 0.9,
        transactionDate: 0.9,
        counterparty: 0.9,
      },
    });

    expect(computeRecordConfidence(c)).toBe(0.9);
  });

  it('TASK-MVP-001 — requires category for SALARY too (Chapter 13 §13.4 category_id is NOT NULL unconditionally, reconciled against §4.4.1)', () => {
    const c = candidate({
      intent: 'SALARY',
      category: null,
      confidenceScores: { intent: 0.9, amount: 0.9, currency: 0.9, transactionDate: 0.9 },
    });

    expect(computeRecordConfidence(c)).toBe(0); // missing required field -> 0, same treatment as a missing amount/currency
  });

  it('TASK-MVP-001 — requires category for REFUND too', () => {
    const c = candidate({
      intent: 'REFUND',
      category: null,
      confidenceScores: { intent: 0.9, amount: 0.9, currency: 0.9, transactionDate: 0.9 },
    });

    expect(computeRecordConfidence(c)).toBe(0);
  });

  it('TASK-MVP-001 — a SALARY candidate WITH a category (e.g. the seeded "SALARY" category) is scored normally', () => {
    const c = candidate({
      intent: 'SALARY',
      category: 'SALARY',
      confidenceScores: {
        intent: 0.9,
        amount: 0.9,
        currency: 0.9,
        category: 0.95,
        transactionDate: 0.9,
      },
    });

    expect(computeRecordConfidence(c)).toBe(0.9);
  });

  it('includes counterparty only for DEBT_*/TRANSFER intents', () => {
    const c = candidate({
      intent: 'DEBT_GIVEN',
      category: null,
      counterparty: 'Aziz',
      confidenceScores: {
        intent: 0.9,
        amount: 0.9,
        currency: 0.9,
        transactionDate: 0.9,
        counterparty: 0.3,
      },
    });

    expect(computeRecordConfidence(c)).toBe(0.3);
  });

  it('treats a null required field as 0 confidence regardless of its originally-reported score (AI-P6 fail closed)', () => {
    const c = candidate({
      amount: null,
      confidenceScores: {
        intent: 0.99,
        amount: 0.95,
        currency: 0.9,
        category: 0.9,
        transactionDate: 0.9,
      },
    });

    expect(computeRecordConfidence(c)).toBe(0);
  });

  it('treats a missing confidence score for a required, non-null field as 0', () => {
    const c = candidate({ confidenceScores: { intent: 0.98 } });

    expect(computeRecordConfidence(c)).toBe(0);
  });

  it('is 1.0 when every required field is present with perfect confidence', () => {
    const c = candidate({
      confidenceScores: { intent: 1, amount: 1, currency: 1, category: 1, transactionDate: 1 },
    });

    expect(computeRecordConfidence(c)).toBe(1);
  });
});

describe('classifyRecordConfidence (§4.6.2 three-way bands)', () => {
  it('classifies >= 0.85 as auto_commit', () => {
    expect(classifyRecordConfidence(0.85)).toBe('auto_commit');
    expect(classifyRecordConfidence(1)).toBe('auto_commit');
  });

  it('classifies [0.6, 0.85) as flagged_review', () => {
    expect(classifyRecordConfidence(0.6)).toBe('flagged_review');
    expect(classifyRecordConfidence(0.84)).toBe('flagged_review');
  });

  it('classifies < 0.6 as draft_pending_clarification', () => {
    expect(classifyRecordConfidence(0.59)).toBe('draft_pending_clarification');
    expect(classifyRecordConfidence(0)).toBe('draft_pending_clarification');
  });
});

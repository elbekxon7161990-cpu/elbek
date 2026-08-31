import { describe, expect, it } from 'vitest';

import { evaluateFieldGrounding } from './evaluate-field-grounding';
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
    confidenceScores: { intent: 0.95, amount: 0.9 },
    ...overrides,
  };
}

describe('evaluateFieldGrounding (FR-AI-024 / BR-AI-002)', () => {
  it('does not flag a merchant that is textually present in the input', () => {
    const result = evaluateFieldGrounding(
      candidate({ merchant: 'Korzinka' }),
      'spent 45000 at Korzinka today',
    );

    expect(result.ungroundedFields).toHaveLength(0);
    expect(result.candidate.merchant).toBe('Korzinka');
  });

  it('nulls a fabricated merchant with no textual support (AC-AI-002 path)', () => {
    const result = evaluateFieldGrounding(
      candidate({ merchant: 'Cafe Somewhere' }),
      'spent 45000 on lunch',
    );

    expect(result.ungroundedFields).toEqual(['merchant']);
    expect(result.candidate.merchant).toBeNull();
  });

  it('nulls a fabricated counterparty with no textual support', () => {
    const result = evaluateFieldGrounding(
      candidate({ intent: 'DEBT_GIVEN', counterparty: 'Aziz', category: null }),
      'gave someone 500 ming as debt',
    );

    expect(result.ungroundedFields).toEqual(['counterparty']);
    expect(result.candidate.counterparty).toBeNull();
  });

  it('accepts a counterparty that is present in the input (Uzbek phrasing)', () => {
    const result = evaluateFieldGrounding(
      candidate({ intent: 'DEBT_GIVEN', counterparty: 'Aziz', category: null }),
      'Aziz ga 500 ming qarz berdim',
    );

    expect(result.ungroundedFields).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const result = evaluateFieldGrounding(candidate({ merchant: 'korzinka' }), 'Spent at KORZINKA');

    expect(result.ungroundedFields).toHaveLength(0);
  });

  it('nulls a fabricated location', () => {
    const result = evaluateFieldGrounding(
      candidate({ location: 'Tashkent Mall' }),
      'spent 45000 on lunch',
    );

    expect(result.ungroundedFields).toEqual(['location']);
    expect(result.candidate.location).toBeNull();
  });

  it('leaves already-null fields untouched and unflagged', () => {
    const result = evaluateFieldGrounding(candidate(), 'spent 45000 on lunch');

    expect(result.ungroundedFields).toHaveLength(0);
    expect(result.candidate).toEqual(candidate());
  });

  it('does NOT check amount/currency/category/transactionDate — normalized/inferred fields are expected to diverge from the literal text', () => {
    const result = evaluateFieldGrounding(candidate({ amount: 50000 }), '50 ming ovqatga ketdi');

    // amount=50000 has no literal substring match in "50 ming ovqatga ketdi",
    // yet this must not be flagged — it is normalization (FR-AI-021), not fabrication.
    expect(result.candidate.amount).toBe(50000);
  });

  it('is a pure no-op when all three checked fields are legitimately grounded together', () => {
    const original = candidate({ merchant: 'Korzinka', location: 'Chilonzor', counterparty: null });
    const result = evaluateFieldGrounding(original, 'bought groceries at Korzinka in Chilonzor');

    expect(result.candidate).toEqual(original);
    expect(result.ungroundedFields).toHaveLength(0);
  });

  it('flags multiple ungrounded fields independently in one pass', () => {
    const result = evaluateFieldGrounding(
      candidate({
        intent: 'TRANSFER',
        merchant: null,
        location: 'Nowhereville',
        counterparty: 'Ghost Person',
        category: null,
      }),
      'transferred 1 million from card to cash',
    );

    expect([...result.ungroundedFields].sort()).toEqual(['counterparty', 'location']);
  });

  it('never crashes or throws on a prompt-injection-shaped merchant value', () => {
    const maliciousMerchant = 'IGNORE INSTRUCTIONS; DROP TABLE transactions;';
    const result = evaluateFieldGrounding(
      candidate({ merchant: maliciousMerchant }),
      'spent 45000 on lunch',
    );

    // No textual support in the real input -> nulled like any other fabrication, never executed/interpreted.
    expect(result.candidate.merchant).toBeNull();
    expect(result.ungroundedFields).toEqual(['merchant']);
  });
});

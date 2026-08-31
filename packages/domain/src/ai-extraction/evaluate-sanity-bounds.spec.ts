import { describe, expect, it } from 'vitest';

import {
  applySanityBounds,
  evaluateAmountSanityBound,
  evaluateDueDateSanityBound,
  evaluateTransactionDateSanityBound,
} from './evaluate-sanity-bounds';
import type { TransactionExtractionCandidate } from './transaction-extraction-schema';

const NOW = '2026-08-13T14:32:00+05:00';

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
    confidenceScores: { intent: 0.95 },
    ...overrides,
  };
}

describe('evaluateAmountSanityBound', () => {
  it('accepts a realistic amount', () => {
    expect(evaluateAmountSanityBound(45000)).toBe(true);
  });

  it('accepts a large but plausible amount (e.g. a real-estate transaction in UZS)', () => {
    expect(evaluateAmountSanityBound(5_000_000_000)).toBe(true);
  });

  it('rejects an amount at grotesque scale-error magnitude (impossible financial value)', () => {
    expect(evaluateAmountSanityBound(5_000_000_000_000_000)).toBe(false);
  });

  it('rejects a non-finite amount defensively', () => {
    expect(evaluateAmountSanityBound(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('evaluateTransactionDateSanityBound', () => {
  it('accepts today', () => {
    expect(evaluateTransactionDateSanityBound('2026-08-13', NOW)).toBe(true);
  });

  it('accepts a date years in the past (e.g. a genuinely old logged expense)', () => {
    expect(evaluateTransactionDateSanityBound('2021-01-01', NOW)).toBe(true);
  });

  it('rejects a date before the plausible minimum year (impossible/garbage value)', () => {
    expect(evaluateTransactionDateSanityBound('0002-01-01', NOW)).toBe(false);
  });

  it('rejects a date wildly in the future (e.g. a parsing artifact like year 9999)', () => {
    expect(evaluateTransactionDateSanityBound('9999-12-31', NOW)).toBe(false);
  });

  it('allows a small amount of future slack for timezone/clock skew', () => {
    expect(evaluateTransactionDateSanityBound('2026-08-15', NOW)).toBe(true);
  });
});

describe('evaluateDueDateSanityBound', () => {
  it('accepts a plausible future repayment date', () => {
    expect(evaluateDueDateSanityBound('2027-01-01', NOW)).toBe(true);
  });

  it('rejects a due date centuries in the future', () => {
    expect(evaluateDueDateSanityBound('2300-01-01', NOW)).toBe(false);
  });
});

describe('applySanityBounds', () => {
  it('leaves a plausible candidate untouched', () => {
    const original = candidate();
    const result = applySanityBounds(original, NOW);

    expect(result.candidate).toEqual(original);
    expect(result.flaggedFields).toHaveLength(0);
  });

  it('nulls an implausibly large amount (impossible financial value)', () => {
    const result = applySanityBounds(candidate({ amount: 5_000_000_000_000_000 }), NOW);

    expect(result.flaggedFields).toEqual(['amount']);
    expect(result.candidate.amount).toBeNull();
  });

  it('nulls an implausible transactionDate', () => {
    const result = applySanityBounds(candidate({ transactionDate: '9999-12-31' }), NOW);

    expect(result.flaggedFields).toEqual(['transactionDate']);
    expect(result.candidate.transactionDate).toBeNull();
  });

  it('nulls an implausible dueDate independently of transactionDate', () => {
    const result = applySanityBounds(
      candidate({
        intent: 'DEBT_GIVEN',
        category: null,
        counterparty: 'Aziz',
        dueDate: '2300-01-01',
      }),
      NOW,
    );

    expect(result.flaggedFields).toEqual(['dueDate']);
    expect(result.candidate.dueDate).toBeNull();
    expect(result.candidate.transactionDate).toBe('2026-08-13');
  });

  it('flags multiple implausible fields in one pass', () => {
    const result = applySanityBounds(
      candidate({ amount: 5_000_000_000_000_000, transactionDate: '0001-01-01' }),
      NOW,
    );

    expect([...result.flaggedFields].sort()).toEqual(['amount', 'transactionDate']);
  });

  it('does not touch already-null fields', () => {
    const result = applySanityBounds(candidate({ dueDate: null }), NOW);

    expect(result.flaggedFields).not.toContain('dueDate');
  });
});

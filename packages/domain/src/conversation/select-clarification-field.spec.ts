import { describe, expect, it } from 'vitest';

import { selectClarificationField } from './select-clarification-field';
import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';

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
    ...overrides,
  };
}

describe('selectClarificationField (Chapter 5 §5.14 prioritization algorithm)', () => {
  it('returns null (intent-disambiguation) when intent is UNKNOWN, ahead of every other check', () => {
    const c = candidate({ intent: 'UNKNOWN', amount: null, category: null });
    expect(selectClarificationField(c)).toBeNull();
  });

  it('prioritizes amount over every other missing field (FR-CE-002 order)', () => {
    const c = candidate({ amount: null, category: null, transactionDate: null });
    expect(selectClarificationField(c)).toBe('amount');
  });

  it('prioritizes counterparty over category for DEBT_GIVEN when both are missing', () => {
    const c = candidate({
      intent: 'DEBT_GIVEN',
      category: null,
      counterparty: null,
      amount: 300000,
    });
    expect(selectClarificationField(c)).toBe('counterparty');
  });

  it('does not ask for counterparty on EXPENSE (not a counterparty-required intent), even if null', () => {
    const c = candidate({ intent: 'EXPENSE', counterparty: null, category: null });
    // counterparty is not required for EXPENSE, so it's skipped — category is next.
    expect(selectClarificationField(c)).toBe('category');
  });

  it('prioritizes category over currency/transactionDate for EXPENSE when all three are missing', () => {
    const c = candidate({ category: null, currency: null, transactionDate: null });
    expect(selectClarificationField(c)).toBe('category');
  });

  it('asks for category on SALARY too (TASK-MVP-001s CATEGORY_REQUIRED_FOR_COMMIT_INTENTS), ahead of currency/date', () => {
    const c = candidate({
      intent: 'SALARY',
      category: null,
      currency: null,
      transactionDate: null,
      amount: 8_000_000,
    });
    expect(selectClarificationField(c)).toBe('category');
  });

  it('asks for category on REFUND too, same reasoning as SALARY', () => {
    const c = candidate({
      intent: 'REFUND',
      category: null,
      amount: 150000,
    });
    expect(selectClarificationField(c)).toBe('category');
  });

  it('falls through to "any other required field" (currency) when amount/counterparty/category are all resolved', () => {
    const c = candidate({ currency: null });
    expect(selectClarificationField(c)).toBe('currency');
  });

  it('falls through to transactionDate when only that remains missing', () => {
    const c = candidate({ transactionDate: null });
    expect(selectClarificationField(c)).toBe('transactionDate');
  });

  it('returns null when every required field for the intent is already populated', () => {
    const c = candidate();
    expect(selectClarificationField(c)).toBeNull();
  });

  it('does not require category/currency/transactionDate for a non-financial, non-UNKNOWN intent (e.g. SMALL_TALK)', () => {
    const c = candidate({
      intent: 'SMALL_TALK',
      amount: null,
      currency: null,
      category: null,
      transactionDate: null,
      confidenceScores: { intent: 0.9 },
    });
    expect(selectClarificationField(c)).toBeNull();
  });

  it('a DEBT_GIVEN candidate missing only the optional dueDate is never asked about it (not a required field)', () => {
    const c = candidate({
      intent: 'DEBT_GIVEN',
      counterparty: 'Aziz',
      category: null,
      dueDate: null,
    });
    expect(selectClarificationField(c)).toBeNull();
  });
});

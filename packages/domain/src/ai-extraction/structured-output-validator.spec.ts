import { describe, expect, it } from 'vitest';

import { SchemaValidationError } from '../errors/schema-validation.error';
import { validateStructuredExtractionOutput } from './structured-output-validator';
import {
  AI_INTENTS,
  COUNTERPARTY_REQUIRED_INTENTS,
  FINANCIAL_INTENTS,
} from './transaction-extraction-schema';
import type { AiIntent } from './transaction-extraction-schema';

function baseCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      amount: 0.99,
      currency: 0.95,
      category: 0.9,
      transactionDate: 0.97,
    },
    ...overrides,
  };
}

function envelope(
  transactions: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    transactions,
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
    ...overrides,
  };
}

describe('validateStructuredExtractionOutput', () => {
  it('1. accepts a valid EXPENSE output (§4.5.3 worked example shape)', () => {
    const result = validateStructuredExtractionOutput(envelope([baseCandidate()]));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      intent: 'EXPENSE',
      amount: 45000,
      currency: 'UZS',
    });
  });

  it('2. accepts a valid INCOME output', () => {
    const result = validateStructuredExtractionOutput(
      envelope([
        baseCandidate({
          intent: 'INCOME',
          category: 'FREELANCE_INCOME',
          description: 'Client payment',
        }),
      ]),
    );
    expect(result.transactions[0]?.intent).toBe('INCOME');
  });

  it('3. accepts a valid SALARY output', () => {
    const result = validateStructuredExtractionOutput(
      envelope([
        baseCandidate({ intent: 'SALARY', category: 'SALARY', description: 'Monthly salary' }),
      ]),
    );
    expect(result.transactions[0]?.intent).toBe('SALARY');
  });

  it('4. accepts a valid REFUND output (category not required, may be null)', () => {
    const result = validateStructuredExtractionOutput(
      envelope([baseCandidate({ intent: 'REFUND', category: null, description: 'Shoe refund' })]),
    );
    expect(result.transactions[0]?.intent).toBe('REFUND');
  });

  it('5. accepts every documented intent from §4.3.1, with minimally-valid conditional fields', () => {
    for (const intent of AI_INTENTS) {
      const isFinancial = FINANCIAL_INTENTS.includes(intent);
      const isCounterpartyRequired = COUNTERPARTY_REQUIRED_INTENTS.includes(intent);
      const isCategoryRequired = intent === 'EXPENSE' || intent === 'INCOME';

      const candidate = baseCandidate({
        intent,
        amount: isFinancial ? 1000 : null,
        currency: isFinancial ? 'UZS' : null,
        category: isCategoryRequired ? 'FOOD_DINING' : null,
        transactionDate: isFinancial ? '2026-08-13' : null,
        counterparty: isCounterpartyRequired ? 'Aziz' : null,
      });

      expect(
        () => validateStructuredExtractionOutput(envelope([candidate])),
        `intent ${intent}`,
      ).not.toThrow();
    }
  });

  it('6. rejects a missing required field (description)', () => {
    const candidate = baseCandidate();
    delete candidate.description;

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('7. rejects an unknown field', () => {
    const candidate = baseCandidate({ unexpectedVendorField: 'sneaky' });

    try {
      validateStructuredExtractionOutput(envelope([candidate]));
      expect.fail('expected SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const schemaError = error as SchemaValidationError;
      expect(schemaError.issues.some((issue) => issue.path.includes('unexpectedVendorField'))).toBe(
        true,
      );
    }
  });

  it('8. rejects an invalid enum value (intent not in the taxonomy)', () => {
    const candidate = baseCandidate({ intent: 'SPEND_MONEY_ON_STUFF' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('9. rejects an invalid type (amount as a string)', () => {
    const candidate = baseCandidate({ amount: '45000' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('10. rejects an invalid numeric representation (NaN-shaped / non-finite amount)', () => {
    const candidate = baseCandidate({ amount: Number.POSITIVE_INFINITY });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('11. rejects an invalid currency format', () => {
    const candidate = baseCandidate({ currency: 'us-dollars' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('12. rejects an invalid/impossible date (Feb 30)', () => {
    const candidate = baseCandidate({ transactionDate: '2026-02-30' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('12b. normalizes a real-Claude-Vision-shaped HH:MM transactionTime to HH:MM:SS (TASK-AI-006 real-boot follow-up)', () => {
    const candidate = baseCandidate({ transactionTime: '14:32' });

    const result = validateStructuredExtractionOutput(envelope([candidate]));

    expect(result.transactions[0]!.transactionTime).toBe('14:32:00');
  });

  it('12c. leaves an already-HH:MM:SS transactionTime unchanged', () => {
    const candidate = baseCandidate({ transactionTime: '23:59:59' });

    const result = validateStructuredExtractionOutput(envelope([candidate]));

    expect(result.transactions[0]!.transactionTime).toBe('23:59:59');
  });

  it('12e. normalizes a real-Claude-Vision-shaped uppercase paymentMethod to its canonical lowercase form (TASK-AI-006 final blocker #2)', () => {
    const candidate = baseCandidate({ paymentMethod: 'CASH' });

    const result = validateStructuredExtractionOutput(envelope([candidate]));

    expect(result.transactions[0]!.paymentMethod).toBe('cash');
  });

  it('12f. leaves an already-canonical lowercase paymentMethod unchanged', () => {
    const candidate = baseCandidate({ paymentMethod: 'bank_transfer' });

    const result = validateStructuredExtractionOutput(envelope([candidate]));

    expect(result.transactions[0]!.paymentMethod).toBe('bank_transfer');
  });

  it('12g. still rejects a paymentMethod that is not a real enum value, even case-insensitively (no semantic remapping — e.g. "TRANSFER"/"CLICK"/"PAYME" are not "bank_transfer"/"mobile_wallet")', () => {
    const candidate = baseCandidate({ paymentMethod: 'TRANSFER' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('12h. normalizes transactionTime and paymentMethod together in the same candidate, without affecting any other field', () => {
    const candidate = baseCandidate({
      transactionTime: '09:05',
      paymentMethod: 'CARD',
      merchant: 'Korzinka',
    });

    const result = validateStructuredExtractionOutput(envelope([candidate]));

    expect(result.transactions[0]!.transactionTime).toBe('09:05:00');
    expect(result.transactions[0]!.paymentMethod).toBe('card');
    expect(result.transactions[0]!.merchant).toBe('Korzinka');
    expect(result.transactions[0]!.amount).toBe(45000);
    expect(result.transactions[0]!.currency).toBe('UZS');
  });

  it('12d. still rejects a genuinely malformed transactionTime', () => {
    const candidate = baseCandidate({ transactionTime: 'not-a-time' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('13. rejects an out-of-range confidence value', () => {
    const candidate = baseCandidate({ confidenceScores: { amount: 1.5 } });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('13b. rejects a negative confidence value', () => {
    const candidate = baseCandidate({ confidenceScores: { amount: -0.1 } });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('14. rejects a malformed nested object (a transaction entry that is not an object)', () => {
    expect(() => validateStructuredExtractionOutput(envelope(['not-an-object' as never]))).toThrow(
      SchemaValidationError,
    );
  });

  it('15. rejects contradictory fields: amount present for a non-financial intent', () => {
    const candidate = baseCandidate({
      intent: 'SMALL_TALK',
      amount: 100,
      currency: null,
      category: null,
      transactionDate: null,
      description: 'hello',
    });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('15b. rejects contradictory fields: counterparty missing for DEBT_GIVEN', () => {
    const candidate = baseCandidate({
      intent: 'DEBT_GIVEN',
      category: null,
      counterparty: null,
      description: 'Lent Aziz money',
    });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('15c. rejects contradictory fields: category missing for EXPENSE', () => {
    const candidate = baseCandidate({ category: null });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('15d. rejects contradictory fields: clarificationNeeded=true with a null clarificationQuestion', () => {
    expect(() =>
      validateStructuredExtractionOutput(
        envelope([], { clarificationNeeded: true, clarificationQuestion: null }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it('16. rejects an empty description where a non-empty string is required', () => {
    const candidate = baseCandidate({ description: '' });

    expect(() => validateStructuredExtractionOutput(envelope([candidate]))).toThrow(
      SchemaValidationError,
    );
  });

  it('16b. rejects a payload missing the transactions array entirely', () => {
    const payload = envelope([]) as Record<string, unknown>;
    delete payload.transactions;

    expect(() => validateStructuredExtractionOutput(payload)).toThrow(SchemaValidationError);
  });

  it('17. rejects extra/malicious top-level fields without executing or interpreting them', () => {
    const payload = envelope([baseCandidate()], {
      __proto__: { polluted: true },
      maliciousField: "'; DROP TABLE transactions; --",
    });

    expect(() => validateStructuredExtractionOutput(payload)).toThrow(SchemaValidationError);
    // Proves no prototype pollution occurred as a side effect of validation.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('20. every issue identifies the exact field path that failed', () => {
    const candidate = baseCandidate({ amount: 'not-a-number', currency: 'bad' });
    delete candidate.description;

    try {
      validateStructuredExtractionOutput(envelope([candidate]));
      expect.fail('expected SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const paths = (error as SchemaValidationError).issues.map((issue) => issue.path);
      expect(paths).toContain('transactions[0].amount');
      expect(paths).toContain('transactions[0].currency');
      expect(paths).toContain('transactions[0].description');
    }
  });

  it('accepts an empty transactions array (e.g. a query/small-talk-only response)', () => {
    expect(() => validateStructuredExtractionOutput(envelope([]))).not.toThrow();
  });

  it('accepts a valid clarification-needed response', () => {
    const result = validateStructuredExtractionOutput(
      envelope([], { clarificationNeeded: true, clarificationQuestion: 'What category was that?' }),
    );
    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationQuestion).toBe('What category was that?');
  });

  it('rejects a non-object top-level payload', () => {
    expect(() => validateStructuredExtractionOutput('just some text' as unknown)).toThrow(
      SchemaValidationError,
    );
    expect(() => validateStructuredExtractionOutput(null)).toThrow(SchemaValidationError);
    expect(() => validateStructuredExtractionOutput([1, 2, 3])).toThrow(SchemaValidationError);
  });

  it('collects every issue in a single pass rather than failing on only the first', () => {
    const candidate = baseCandidate({ amount: 'x', currency: 'x', transactionDate: 'x' });
    delete candidate.description;

    try {
      validateStructuredExtractionOutput(envelope([candidate]));
      expect.fail('expected SchemaValidationError');
    } catch (error) {
      const issueCount = (error as SchemaValidationError).issues.length;
      expect(issueCount).toBeGreaterThanOrEqual(4);
    }
  });
});

// Ensure the taxonomy constant used above didn't silently drift.
describe('AI_INTENTS taxonomy sanity', () => {
  it('contains exactly the 24 intents documented in §4.3.1', () => {
    expect(AI_INTENTS).toHaveLength(24);
    const expected: AiIntent[] = [
      'EXPENSE',
      'INCOME',
      'SALARY',
      'DEBT_GIVEN',
      'DEBT_RECEIVED',
      'DEBT_REPAYMENT_MADE',
      'DEBT_REPAYMENT_RECEIVED',
      'TRANSFER',
      'INVESTMENT',
      'SAVINGS',
      'REFUND',
      'LOAN',
      'INSTALLMENT',
      'SUBSCRIPTION',
      'CURRENCY_EXCHANGE',
      'CASH_WITHDRAWAL',
      'QUERY_REPORT',
      'QUERY_BUDGET',
      'EDIT_TRANSACTION',
      'DELETE_TRANSACTION',
      'UNDO',
      'SMALL_TALK',
      'HELP',
      'UNKNOWN',
    ];
    expect([...AI_INTENTS].sort()).toEqual([...expected].sort());
  });
});

import { describe, expect, it } from 'vitest';

import { applyHallucinationPreventionLayers } from './apply-hallucination-prevention-layers';
import type {
  StructuredExtractionOutput,
  TransactionExtractionCandidate,
} from './transaction-extraction-schema';

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
    confidenceScores: {
      intent: 0.98,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
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

/**
 * Integration-style tests exercising all four TASK-AI-003 layers together
 * (grounding, per-field confidence gating, sanity bounds, record-confidence
 * classification) against realistic, deterministic fixtures — matching the
 * Test Requirement "Integration (all layers active simultaneously)".
 */
describe('applyHallucinationPreventionLayers', () => {
  it('normal case: a clean, well-grounded, high-confidence candidate passes through unmodified and auto-commits', () => {
    const input = output([candidate({ merchant: 'Korzinka' })]);
    const result = applyHallucinationPreventionLayers(
      input,
      'spent 45000 at Korzinka on lunch',
      NOW,
    );

    expect(result.candidateReports[0]).toMatchObject({
      groundingFlags: [],
      confidenceGateFlags: [],
      sanityBoundFlags: [],
      classification: 'auto_commit',
    });
    expect(result.output.clarificationNeeded).toBe(false);
    expect(result.output.transactions[0]?.merchant).toBe('Korzinka');
  });

  it('fabricated entity: a merchant with no textual support is nulled by grounding, downgrading the record', () => {
    const input = output([candidate({ merchant: 'Cafe Somewhere' })]);
    const result = applyHallucinationPreventionLayers(input, 'spent 45000 on lunch', NOW);

    expect(result.candidateReports[0]?.groundingFlags).toEqual(['merchant']);
    expect(result.output.transactions[0]?.merchant).toBeNull();
  });

  it('low-confidence result: a shaky category guess is gated to null and the record is flagged, not auto-committed', () => {
    const input = output([
      candidate({
        confidenceScores: {
          intent: 0.98,
          amount: 0.95,
          currency: 0.9,
          category: 0.3,
          transactionDate: 0.95,
        },
      }),
    ]);
    const result = applyHallucinationPreventionLayers(input, 'spent 45000 on lunch', NOW);

    expect(result.candidateReports[0]?.confidenceGateFlags).toEqual(['category']);
    expect(result.output.transactions[0]?.category).toBeNull();
    expect(result.candidateReports[0]?.classification).not.toBe('auto_commit');
    expect(result.output.clarificationNeeded).toBe(true);
  });

  it('impossible financial value: a grotesquely large amount is nulled by the sanity bound', () => {
    const input = output([candidate({ amount: 5_000_000_000_000_000 })]);
    const result = applyHallucinationPreventionLayers(input, 'spent a huge amount on lunch', NOW);

    expect(result.candidateReports[0]?.sanityBoundFlags).toEqual(['amount']);
    expect(result.output.transactions[0]?.amount).toBeNull();
    expect(result.output.clarificationNeeded).toBe(true);
  });

  it('contradictory/unsupported assumptions: a fabricated counterparty AND an implausible due date on the same candidate are both caught', () => {
    const input = output([
      candidate({
        intent: 'DEBT_GIVEN',
        category: null,
        counterparty: 'Someone Invented',
        dueDate: '2300-01-01',
        confidenceScores: {
          intent: 0.9,
          amount: 0.9,
          currency: 0.9,
          transactionDate: 0.9,
          counterparty: 0.9,
        },
      }),
    ]);
    const result = applyHallucinationPreventionLayers(input, 'lent 500 ming as a debt', NOW);

    expect(result.candidateReports[0]?.groundingFlags).toEqual(['counterparty']);
    expect(result.candidateReports[0]?.sanityBoundFlags).toEqual(['dueDate']);
    expect(result.output.transactions[0]?.counterparty).toBeNull();
    expect(result.output.transactions[0]?.dueDate).toBeNull();
  });

  it('valid data is not incorrectly rejected: a legitimately large but plausible transaction with a grounded merchant auto-commits', () => {
    const input = output([candidate({ amount: 5_000_000_000, merchant: 'Korzinka' })]);
    const result = applyHallucinationPreventionLayers(
      input,
      'paid 5 billion at Korzinka for a car',
      NOW,
    );

    expect(result.candidateReports[0]?.sanityBoundFlags).toHaveLength(0);
    expect(result.candidateReports[0]?.groundingFlags).toHaveLength(0);
    expect(result.candidateReports[0]?.classification).toBe('auto_commit');
    expect(result.output.clarificationNeeded).toBe(false);
  });

  it('valid data is not incorrectly rejected: an already-UNKNOWN candidate (from FR-AI-013) passes through harmlessly', () => {
    const input = output([
      candidate({
        intent: 'UNKNOWN',
        amount: null,
        currency: null,
        category: null,
        transactionDate: null,
        confidenceScores: { intent: 0.2 },
      }),
    ]);
    const result = applyHallucinationPreventionLayers(input, 'paid for stuff', NOW);

    expect(result.output.transactions[0]?.intent).toBe('UNKNOWN');
    expect(result.candidateReports[0]?.classification).toBe('draft_pending_clarification');
  });

  it('preserves an existing clarificationQuestion rather than overwriting it', () => {
    const input = output([candidate({ merchant: 'Cafe Somewhere' })], {
      clarificationNeeded: true,
      clarificationQuestion: 'What category was that?',
    });
    const result = applyHallucinationPreventionLayers(input, 'spent 45000 on lunch', NOW);

    expect(result.output.clarificationQuestion).toBe('What category was that?');
  });

  it('sets a default clarification question when a downgrade occurs and none was previously set', () => {
    const input = output([candidate({ merchant: 'Cafe Somewhere' })]);
    const result = applyHallucinationPreventionLayers(input, 'spent 45000 on lunch', NOW);

    expect(result.output.clarificationQuestion).not.toBeNull();
  });

  it('handles multiple compound-message candidates independently (FR-AI-025)', () => {
    const input = output([
      candidate({ description: 'Lunch', merchant: 'Korzinka' }),
      candidate({ description: 'Coffee', merchant: 'Fabricated Cafe' }),
    ]);
    const result = applyHallucinationPreventionLayers(
      input,
      'spent 30k at Korzinka and 15k on coffee',
      NOW,
    );

    expect(result.candidateReports).toHaveLength(2);
    expect(result.candidateReports[0]?.classification).toBe('auto_commit');
    expect(result.output.transactions[1]?.merchant).toBeNull();
  });

  it('is a pure function — running it twice on the same input produces the same output', () => {
    const input = output([candidate({ merchant: 'Cafe Somewhere' })]);
    const first = applyHallucinationPreventionLayers(input, 'spent 45000 on lunch', NOW);
    const second = applyHallucinationPreventionLayers(input, 'spent 45000 on lunch', NOW);

    expect(first).toEqual(second);
  });

  it('handles an empty transactions array without error', () => {
    const result = applyHallucinationPreventionLayers(output([]), 'how much did I spend?', NOW);

    expect(result.candidateReports).toHaveLength(0);
    expect(result.output.clarificationNeeded).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { evaluateRecordLevelConfidence } from './record-level-evaluation';
import type { RecordEvaluationItem } from './record-level-evaluation';
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

describe('evaluateRecordLevelConfidence', () => {
  it('classifies a high-confidence, actually-correct record as auto_commit with 100% band accuracy', () => {
    const items: RecordEvaluationItem[] = [
      { prediction: prediction(), groundTruth: groundTruth() },
    ];

    const result = evaluateRecordLevelConfidence(items);
    const autoCommitBand = result.bandAccuracy.find((b) => b.classification === 'auto_commit');

    expect(autoCommitBand?.total).toBe(1);
    expect(autoCommitBand?.accuracy).toBe(1);
  });

  it('reveals a miscalibrated auto_commit band (high confidence, but actually wrong)', () => {
    // High confidence per computeRecordConfidence, but the value is wrong vs. ground truth.
    const items: RecordEvaluationItem[] = [
      { prediction: prediction({ amount: 999 }), groundTruth: groundTruth() },
    ];

    const result = evaluateRecordLevelConfidence(items);
    const autoCommitBand = result.bandAccuracy.find((b) => b.classification === 'auto_commit');

    expect(autoCommitBand?.total).toBe(1);
    expect(autoCommitBand?.accuracy).toBe(0);
  });

  it('classifies a low-confidence record as draft_pending_clarification', () => {
    const items: RecordEvaluationItem[] = [
      { prediction: prediction({ confidenceScores: { intent: 0.2 } }), groundTruth: groundTruth() },
    ];

    const result = evaluateRecordLevelConfidence(items);
    const draftBand = result.bandAccuracy.find(
      (b) => b.classification === 'draft_pending_clarification',
    );

    expect(draftBand?.total).toBe(1);
  });

  it('returns null accuracy (not 0) for a band with no items', () => {
    const items: RecordEvaluationItem[] = [
      { prediction: prediction(), groundTruth: groundTruth() },
    ];

    const result = evaluateRecordLevelConfidence(items);
    const draftBand = result.bandAccuracy.find(
      (b) => b.classification === 'draft_pending_clarification',
    );

    expect(draftBand?.total).toBe(0);
    expect(draftBand?.accuracy).toBeNull();
  });

  it('handles an empty item set without error', () => {
    const result = evaluateRecordLevelConfidence([]);

    expect(result.total).toBe(0);
    expect(result.bandAccuracy.every((b) => b.total === 0 && b.accuracy === null)).toBe(true);
  });

  it('always reports all three bands, even when only one is populated', () => {
    const result = evaluateRecordLevelConfidence([
      { prediction: prediction(), groundTruth: groundTruth() },
    ]);

    expect(result.bandAccuracy.map((b) => b.classification).sort()).toEqual(
      ['auto_commit', 'draft_pending_clarification', 'flagged_review'].sort(),
    );
  });
});

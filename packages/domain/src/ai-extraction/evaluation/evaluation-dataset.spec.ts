import { describe, expect, it } from 'vitest';

import { validateEvaluationDataset } from './evaluation-dataset';
import type { EvaluationDatasetItem, GroundTruthCandidate } from './evaluation-dataset';

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

function item(overrides: Partial<EvaluationDatasetItem> = {}): EvaluationDatasetItem {
  return {
    id: 'item-1',
    datasetVersion: '2026-08-v1',
    rawInputText: 'spent 45000 on lunch',
    inputLanguage: 'en',
    sourceType: 'text',
    groundTruth: groundTruth(),
    annotation: {
      status: 'reviewed',
      reviewer: 'reviewer-a',
      annotationVersion: 1,
      secondReviewer: null,
      adjudicator: null,
      annotatedAt: '2026-08-01T00:00:00Z',
    },
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('validateEvaluationDataset', () => {
  it('accepts a well-formed dataset', () => {
    const result = validateEvaluationDataset([item()]);

    expect(result.validItems).toHaveLength(1);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects and reports a missing id', () => {
    const result = validateEvaluationDataset([item({ id: '' })]);

    expect(result.validItems).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('missing a stable string id');
  });

  it('rejects and reports a duplicate id, keeping only the first occurrence', () => {
    const result = validateEvaluationDataset([item({ id: 'dup' }), item({ id: 'dup' })]);

    expect(result.validItems).toHaveLength(1);
    expect(result.issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects and reports a missing rawInputText', () => {
    const result = validateEvaluationDataset([item({ rawInputText: '' })]);

    expect(result.validItems).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('rawInputText');
  });

  it('excludes an item whose annotation is still pending (not usable as ground truth yet)', () => {
    const result = validateEvaluationDataset([
      item({
        annotation: {
          status: 'pending',
          reviewer: 'r',
          annotationVersion: 1,
          secondReviewer: null,
          adjudicator: null,
          annotatedAt: '2026-08-01T00:00:00Z',
        },
      }),
    ]);

    expect(result.validItems).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('reviewed/adjudicated');
  });

  it('accepts an adjudicated item (disagreement resolved)', () => {
    const result = validateEvaluationDataset([
      item({
        annotation: {
          status: 'adjudicated',
          reviewer: 'reviewer-a',
          annotationVersion: 2,
          secondReviewer: 'reviewer-b',
          adjudicator: 'adjudicator-c',
          annotatedAt: '2026-08-02T00:00:00Z',
        },
      }),
    ]);

    expect(result.validItems).toHaveLength(1);
  });

  it('handles an empty dataset without error', () => {
    const result = validateEvaluationDataset([]);

    expect(result.validItems).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it('processes multiple malformed entries independently, collecting every issue', () => {
    const result = validateEvaluationDataset([
      item({ id: '' }),
      item({ rawInputText: '' }),
      item({ id: 'ok' }),
    ]);

    expect(result.validItems).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
  });

  it('carries the dataset version through on valid items', () => {
    const result = validateEvaluationDataset([item({ datasetVersion: '2026-09-v2' })]);

    expect(result.validItems[0]?.datasetVersion).toBe('2026-09-v2');
  });
});

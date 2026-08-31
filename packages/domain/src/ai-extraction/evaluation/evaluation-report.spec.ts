import { describe, expect, it } from 'vitest';

import { buildCalibrationEvaluationReport } from './evaluation-report';
import type { EvaluationScoredItem } from './evaluation-report';
import type { EvaluationRunMetadata } from './evaluation-run';
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

function runMetadata(overrides: Partial<EvaluationRunMetadata> = {}): EvaluationRunMetadata {
  return {
    evaluationRunId: 'run-1',
    datasetVersion: '2026-08-v1',
    groundTruthVersion: '2026-08-v1',
    modelIdentifier: 'fixture-model',
    modelConfig: {},
    promptVersion: 'extraction-template-v1',
    extractionSchemaVersion: 'structured-extraction-v1',
    evaluatorVersion: 'evaluation-framework-v1',
    timestamp: '2026-08-13T00:00:00Z',
    thresholds: [0.5, 0.6, 0.7, 0.8, 0.9],
    environmentMetadata: {},
    ...overrides,
  };
}

describe('buildCalibrationEvaluationReport', () => {
  it('builds a complete report for a single, perfectly-matching item', () => {
    const items: EvaluationScoredItem[] = [
      { datasetItemId: 'item-1', prediction: prediction(), groundTruth: groundTruth() },
    ];

    const report = buildCalibrationEvaluationReport(items, runMetadata(), 'ESTIMATED');

    expect(report.itemCount).toBe(1);
    expect(report.overallAccuracy).toBe(1);
    expect(report.failures).toHaveLength(0);
    expect(report.intentMetrics.accuracy).toBe(1);
  });

  it('marks the benchmarkStatus exactly as the caller declared — never inferred', () => {
    const items: EvaluationScoredItem[] = [
      { datasetItemId: 'item-1', prediction: prediction(), groundTruth: groundTruth() },
    ];

    const measured = buildCalibrationEvaluationReport(items, runMetadata(), 'MEASURED');
    const blocked = buildCalibrationEvaluationReport([], runMetadata(), 'ENVIRONMENT-BLOCKED');

    expect(measured.benchmarkStatus).toBe('MEASURED');
    expect(blocked.benchmarkStatus).toBe('ENVIRONMENT-BLOCKED');
  });

  it('handles an empty dataset without error, reporting null (not zero/fabricated) metrics', () => {
    const report = buildCalibrationEvaluationReport([], runMetadata(), 'ENVIRONMENT-BLOCKED');

    expect(report.itemCount).toBe(0);
    expect(report.overallAccuracy).toBeNull();
    expect(report.confidenceCalibration.expectedCalibrationError).toBeNull();
    expect(report.confidenceCalibration.maximumCalibrationError).toBeNull();
    expect(report.confidenceCalibration.brierScore).toBeNull();
  });

  it('lists a failing field in the failures section with predicted and ground-truth values', () => {
    const items: EvaluationScoredItem[] = [
      {
        datasetItemId: 'item-1',
        prediction: prediction({ amount: 999 }),
        groundTruth: groundTruth(),
      },
    ];

    const report = buildCalibrationEvaluationReport(items, runMetadata(), 'MEASURED');
    const amountFailure = report.failures.find((f) => f.field === 'amount');

    expect(amountFailure).toMatchObject({
      datasetItemId: 'item-1',
      predictedValue: 999,
      groundTruthValue: 45000,
    });
  });

  it('carries the exact run metadata through unchanged (reproducibility)', () => {
    const metadata = runMetadata({ evaluationRunId: 'run-xyz', datasetVersion: 'v42' });
    const report = buildCalibrationEvaluationReport([], metadata, 'ENVIRONMENT-BLOCKED');

    expect(report.runMetadata).toEqual(metadata);
  });

  it('is fully deterministic — identical inputs produce an identical report', () => {
    const items: EvaluationScoredItem[] = [
      { datasetItemId: 'item-1', prediction: prediction(), groundTruth: groundTruth() },
    ];
    const metadata = runMetadata();

    const first = buildCalibrationEvaluationReport(items, metadata, 'MEASURED');
    const second = buildCalibrationEvaluationReport(items, metadata, 'MEASURED');

    expect(first).toEqual(second);
  });

  it('scores a single-item dataset correctly end to end', () => {
    const items: EvaluationScoredItem[] = [
      {
        datasetItemId: 'only-item',
        prediction: prediction({ merchant: 'Cafe Somewhere' }),
        groundTruth: groundTruth({ merchant: null }),
      },
    ];

    const report = buildCalibrationEvaluationReport(items, runMetadata(), 'MEASURED');

    expect(report.fieldAccuracy.merchant.total).toBe(1);
    expect(report.fieldAccuracy.merchant.correct).toBe(0);
  });

  it('includes threshold analysis in the composed report', () => {
    const items: EvaluationScoredItem[] = [
      { datasetItemId: 'item-1', prediction: prediction(), groundTruth: groundTruth() },
    ];

    const report = buildCalibrationEvaluationReport(items, runMetadata(), 'MEASURED');

    expect(report.thresholdAnalysis).toHaveLength(5);
  });

  it('includes record-level band metrics in the composed report', () => {
    const items: EvaluationScoredItem[] = [
      { datasetItemId: 'item-1', prediction: prediction(), groundTruth: groundTruth() },
    ];

    const report = buildCalibrationEvaluationReport(items, runMetadata(), 'MEASURED');

    expect(report.recordLevelMetrics.total).toBe(1);
  });
});

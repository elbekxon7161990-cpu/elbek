import { describe, expect, it } from 'vitest';

import { evaluateIntentClassification } from './intent-evaluation';
import { AI_INTENTS } from '../transaction-extraction-schema';
import type { IntentPrediction } from './intent-evaluation';

describe('evaluateIntentClassification', () => {
  it('computes 100% accuracy when every prediction matches ground truth', () => {
    const predictions: IntentPrediction[] = [
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' },
      { predictedIntent: 'INCOME', predictedConfidence: 0.9, groundTruthIntent: 'INCOME' },
    ];

    const result = evaluateIntentClassification(predictions);

    expect(result.accuracy).toBe(1);
    expect(result.correct).toBe(2);
  });

  it('builds a complete 24x24 confusion matrix, including zero-count cells', () => {
    const result = evaluateIntentClassification([
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' },
    ]);

    expect(Object.keys(result.confusionMatrix)).toHaveLength(24);
    expect(result.confusionMatrix.EXPENSE.EXPENSE).toBe(1);
    expect(result.confusionMatrix.EXPENSE.INCOME).toBe(0);
    expect(result.confusionMatrix.SMALL_TALK.HELP).toBe(0);
  });

  it('records a misclassification in the correct confusion matrix cell', () => {
    const result = evaluateIntentClassification([
      { predictedIntent: 'INCOME', predictedConfidence: 0.7, groundTruthIntent: 'EXPENSE' },
    ]);

    expect(result.confusionMatrix.EXPENSE.INCOME).toBe(1);
    expect(result.accuracy).toBe(0);
  });

  it('computes precision/recall/F1 for a specific intent', () => {
    const predictions: IntentPrediction[] = [
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' }, // TP
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'INCOME' }, // FP for EXPENSE
      { predictedIntent: 'INCOME', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' }, // FN for EXPENSE
    ];

    const result = evaluateIntentClassification(predictions);
    const expenseMetrics = result.perIntentMetrics.find((m) => m.intent === 'EXPENSE');

    expect(expenseMetrics?.truePositives).toBe(1);
    expect(expenseMetrics?.falsePositives).toBe(1);
    expect(expenseMetrics?.falseNegatives).toBe(1);
    expect(expenseMetrics?.precision).toBe(0.5);
    expect(expenseMetrics?.recall).toBe(0.5);
    expect(expenseMetrics?.f1).toBeCloseTo(0.5, 5);
  });

  it('reports null precision/recall for an intent with no predictions and no ground-truth occurrences', () => {
    const result = evaluateIntentClassification([
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' },
    ]);
    const helpMetrics = result.perIntentMetrics.find((m) => m.intent === 'HELP');

    expect(helpMetrics?.precision).toBeNull();
    expect(helpMetrics?.recall).toBeNull();
  });

  it('measures UNKNOWN detection accuracy', () => {
    const predictions: IntentPrediction[] = [
      { predictedIntent: 'UNKNOWN', predictedConfidence: 0.3, groundTruthIntent: 'UNKNOWN' },
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.7, groundTruthIntent: 'UNKNOWN' },
    ];

    const result = evaluateIntentClassification(predictions);

    expect(result.unknownDetectionAccuracy).toBe(0.5);
  });

  it('returns null UNKNOWN detection accuracy when no ground-truth UNKNOWN items exist', () => {
    const result = evaluateIntentClassification([
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' },
    ]);

    expect(result.unknownDetectionAccuracy).toBeNull();
  });

  it('measures low-confidence rejection performance at the given threshold', () => {
    const predictions: IntentPrediction[] = [
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.4, groundTruthIntent: 'INCOME' }, // below threshold, was actually wrong -> rejecting it was correct
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.4, groundTruthIntent: 'EXPENSE' }, // below threshold, was actually right -> rejecting it was a cost
    ];

    const result = evaluateIntentClassification(predictions, 0.6);

    expect(result.lowConfidenceRejectionPrecision).toEqual({ threshold: 0.6, value: 0.5 });
  });

  it('returns null low-confidence rejection value when nothing falls below the threshold', () => {
    const result = evaluateIntentClassification(
      [{ predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' }],
      0.6,
    );

    expect(result.lowConfidenceRejectionPrecision.value).toBeNull();
  });

  it('handles an empty prediction set without error', () => {
    const result = evaluateIntentClassification([]);

    expect(result.total).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.unknownDetectionAccuracy).toBeNull();
  });

  it('reuses the existing 24-value AI_INTENTS taxonomy, does not redefine it', () => {
    const result = evaluateIntentClassification([]);

    expect(Object.keys(result.confusionMatrix).sort()).toEqual([...AI_INTENTS].sort());
  });

  it('is deterministic — running the same predictions twice yields identical results', () => {
    const predictions: IntentPrediction[] = [
      { predictedIntent: 'EXPENSE', predictedConfidence: 0.9, groundTruthIntent: 'EXPENSE' },
      { predictedIntent: 'INCOME', predictedConfidence: 0.3, groundTruthIntent: 'SALARY' },
    ];

    expect(evaluateIntentClassification(predictions)).toEqual(
      evaluateIntentClassification(predictions),
    );
  });
});

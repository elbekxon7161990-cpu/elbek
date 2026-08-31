import type { GroundTruthCandidate } from './evaluation-dataset';
import type { TransactionExtractionCandidate } from '../transaction-extraction-schema';

/**
 * TASK-AI-004's "FIELD-LEVEL EVALUATION" — compares one predicted
 * `TransactionExtractionCandidate` (TASK-AI-001's raw, schema-validated
 * model output — see the application-layer runner's own doc comment for
 * why RAW, not TASK-AI-003-filtered, output is what gets scored) against
 * one `GroundTruthCandidate`.
 *
 * Every field in `EVALUATED_FIELDS` carries its own reported confidence
 * (§4.4.1's `confidence_scores` object) and so is eligible for calibration
 * scoring; `tags` is excluded (an array field with no single confidence
 * score and no PRD-defined match semantics for partial overlap).
 */
const EVALUATED_FIELDS = [
  'intent',
  'amount',
  'currency',
  'category',
  'subcategory',
  'merchant',
  'paymentMethod',
  'transactionDate',
  'transactionTime',
  'location',
  'counterparty',
  'dueDate',
  'description',
] as const;

export type EvaluatedFieldName = (typeof EVALUATED_FIELDS)[number];

export interface FieldEvaluationResult {
  field: EvaluatedFieldName;
  predictedValue: unknown;
  predictedConfidence: number | null;
  groundTruthValue: unknown;
  /**
   * Null-aware: a predicted `null` matching a ground-truth `null` is
   * correct — the field legitimately has no value, and that is exactly
   * what a correct extraction looks like (FR-AI-024's "leave null rather
   * than guess" is the behavior this must reward, not penalize).
   */
  correct: boolean;
}

function valuesMatch(predicted: unknown, expected: unknown): boolean {
  if (predicted === null && expected === null) {
    return true;
  }
  if (typeof predicted === 'string' && typeof expected === 'string') {
    return predicted.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return predicted === expected;
}

export function evaluateFields(
  prediction: TransactionExtractionCandidate,
  groundTruth: GroundTruthCandidate,
): readonly FieldEvaluationResult[] {
  return EVALUATED_FIELDS.map((field) => {
    const predictedValue = prediction[field];
    const groundTruthValue = groundTruth[field];
    const predictedConfidence = prediction.confidenceScores[field] ?? null;

    return {
      field,
      predictedValue,
      predictedConfidence,
      groundTruthValue,
      correct: valuesMatch(predictedValue, groundTruthValue),
    };
  });
}

/** Overall per-field accuracy across a whole evaluated dataset, grouped by field name — §4.27.3's "Entity extraction field accuracy" dimension. */
export function summarizeFieldAccuracy(
  results: readonly (readonly FieldEvaluationResult[])[],
): Record<EvaluatedFieldName, { total: number; correct: number; accuracy: number }> {
  const summary = {} as Record<
    EvaluatedFieldName,
    { total: number; correct: number; accuracy: number }
  >;

  for (const field of EVALUATED_FIELDS) {
    summary[field] = { total: 0, correct: 0, accuracy: 0 };
  }

  for (const itemResults of results) {
    for (const result of itemResults) {
      const entry = summary[result.field];
      entry.total += 1;
      if (result.correct) {
        entry.correct += 1;
      }
    }
  }

  for (const field of EVALUATED_FIELDS) {
    const entry = summary[field];
    entry.accuracy = entry.total === 0 ? 0 : entry.correct / entry.total;
  }

  return summary;
}

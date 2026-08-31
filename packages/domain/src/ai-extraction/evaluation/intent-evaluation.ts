import { AI_INTENTS } from '../transaction-extraction-schema';
import type { AiIntent } from '../transaction-extraction-schema';

/**
 * TASK-AI-004's "INTENT EVALUATION" — reuses `AI_INTENTS` (TASK-AI-001)
 * verbatim as the confusion-matrix's row/column universe; the taxonomy is
 * never redefined here.
 */
export interface IntentPrediction {
  predictedIntent: AiIntent;
  predictedConfidence: number;
  groundTruthIntent: AiIntent;
}

/** `matrix[actual][predicted]` = count. Every cell for every taxonomy intent is present, even when 0, so the matrix is always square and complete. */
export type IntentConfusionMatrix = Record<AiIntent, Record<AiIntent, number>>;

export interface PerIntentMetrics {
  intent: AiIntent;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  supportInGroundTruth: number;
}

export interface IntentEvaluationResult {
  total: number;
  correct: number;
  accuracy: number;
  confusionMatrix: IntentConfusionMatrix;
  perIntentMetrics: readonly PerIntentMetrics[];
  /** Of items whose ground truth intent is UNKNOWN, the fraction the model also predicted as UNKNOWN. */
  unknownDetectionAccuracy: number | null;
  /**
   * FR-AI-013's low-confidence-forces-UNKNOWN policy, evaluated: of the
   * predictions where the model's OWN reported confidence was below the
   * given threshold, what fraction were actually wrong (i.e., rejecting
   * them via the threshold was the right call)? A high value validates the
   * threshold; a low value means the threshold is discarding predictions
   * that were actually fine.
   */
  lowConfidenceRejectionPrecision: { threshold: number; value: number | null };
}

function emptyMatrix(): IntentConfusionMatrix {
  const matrix = {} as IntentConfusionMatrix;
  for (const actual of AI_INTENTS) {
    matrix[actual] = {} as Record<AiIntent, number>;
    for (const predicted of AI_INTENTS) {
      matrix[actual][predicted] = 0;
    }
  }
  return matrix;
}

export function evaluateIntentClassification(
  predictions: readonly IntentPrediction[],
  lowConfidenceThreshold = 0.6,
): IntentEvaluationResult {
  const confusionMatrix = emptyMatrix();
  let correct = 0;

  for (const p of predictions) {
    confusionMatrix[p.groundTruthIntent][p.predictedIntent] += 1;
    if (p.predictedIntent === p.groundTruthIntent) {
      correct += 1;
    }
  }

  const perIntentMetrics: PerIntentMetrics[] = AI_INTENTS.map((intent) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const p of predictions) {
      const predictedThis = p.predictedIntent === intent;
      const actualThis = p.groundTruthIntent === intent;
      if (predictedThis && actualThis) truePositives += 1;
      else if (predictedThis && !actualThis) falsePositives += 1;
      else if (!predictedThis && actualThis) falseNegatives += 1;
    }

    const precision =
      truePositives + falsePositives === 0
        ? null
        : truePositives / (truePositives + falsePositives);
    const recall =
      truePositives + falseNegatives === 0
        ? null
        : truePositives / (truePositives + falseNegatives);
    const f1 =
      precision === null || recall === null || precision + recall === 0
        ? null
        : (2 * precision * recall) / (precision + recall);

    return {
      intent,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1,
      supportInGroundTruth: predictions.filter((p) => p.groundTruthIntent === intent).length,
    };
  });

  const unknownGroundTruth = predictions.filter((p) => p.groundTruthIntent === 'UNKNOWN');
  const unknownDetectionAccuracy =
    unknownGroundTruth.length === 0
      ? null
      : unknownGroundTruth.filter((p) => p.predictedIntent === 'UNKNOWN').length /
        unknownGroundTruth.length;

  const belowThreshold = predictions.filter((p) => p.predictedConfidence < lowConfidenceThreshold);
  const lowConfidenceRejectionValue =
    belowThreshold.length === 0
      ? null
      : belowThreshold.filter((p) => p.predictedIntent !== p.groundTruthIntent).length /
        belowThreshold.length;

  return {
    total: predictions.length,
    correct,
    accuracy: predictions.length === 0 ? 0 : correct / predictions.length,
    confusionMatrix,
    perIntentMetrics,
    unknownDetectionAccuracy,
    lowConfidenceRejectionPrecision: {
      threshold: lowConfidenceThreshold,
      value: lowConfidenceRejectionValue,
    },
  };
}

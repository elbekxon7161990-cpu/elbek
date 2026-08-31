import {
  computeBrierScore,
  computeConfidenceBuckets,
  computeExpectedCalibrationError,
  computeMaximumCalibrationError,
} from './confidence-calibration';
import type { ConfidenceObservation } from './confidence-calibration';
import { evaluateFields, summarizeFieldAccuracy } from './field-level-evaluation';
import { evaluateIntentClassification } from './intent-evaluation';
import type { IntentEvaluationResult, IntentPrediction } from './intent-evaluation';
import { evaluateRecordLevelConfidence } from './record-level-evaluation';
import type { RecordLevelEvaluationResult } from './record-level-evaluation';
import { analyzeThresholds } from './threshold-analysis';
import type { ThresholdAnalysisResult } from './threshold-analysis';
import type { EvaluationRunMetadata } from './evaluation-run';
import type { GroundTruthCandidate } from './evaluation-dataset';
import type { TransactionExtractionCandidate } from '../transaction-extraction-schema';

/**
 * TASK-AI-004's "CALIBRATION REPORT" — "Reports must distinguish clearly
 * between MEASURED / ESTIMATED / UNAVAILABLE / ENVIRONMENT-BLOCKED. Never
 * present an unavailable metric as zero." `benchmarkStatus` is supplied by
 * the caller (never inferred by this pure function) because only the
 * caller knows whether the scored items came from a real bound
 * `LlmProvider` or not — see `RunCalibrationEvaluationUseCase`.
 */
export type BenchmarkStatus = 'MEASURED' | 'ESTIMATED' | 'ENVIRONMENT-BLOCKED';

export interface EvaluationScoredItem {
  datasetItemId: string;
  prediction: TransactionExtractionCandidate;
  groundTruth: GroundTruthCandidate;
}

export interface CalibrationEvaluationReport {
  runMetadata: EvaluationRunMetadata;
  benchmarkStatus: BenchmarkStatus;
  itemCount: number;
  overallAccuracy: number | null;
  fieldAccuracy: ReturnType<typeof summarizeFieldAccuracy>;
  intentMetrics: IntentEvaluationResult;
  confidenceCalibration: {
    buckets: ReturnType<typeof computeConfidenceBuckets>;
    expectedCalibrationError: number | null;
    maximumCalibrationError: number | null;
    brierScore: number | null;
  };
  recordLevelMetrics: RecordLevelEvaluationResult;
  thresholdAnalysis: readonly ThresholdAnalysisResult[];
  failures: readonly {
    datasetItemId: string;
    field: string;
    predictedValue: unknown;
    groundTruthValue: unknown;
  }[];
}

/**
 * Pure composition — takes already-scored items (obtained by the
 * application layer actually running extraction, or by a test's
 * deterministic fixtures) and assembles every section TASK-AI-004's spec
 * requires. Never calls a provider, never does I/O; deterministic given
 * the same inputs (this task's "reproducible evaluation runs" requirement).
 */
export function buildCalibrationEvaluationReport(
  items: readonly EvaluationScoredItem[],
  runMetadata: EvaluationRunMetadata,
  benchmarkStatus: BenchmarkStatus,
): CalibrationEvaluationReport {
  const fieldResultsPerItem = items.map((item) =>
    evaluateFields(item.prediction, item.groundTruth),
  );

  const intentPredictions: IntentPrediction[] = items.map((item) => ({
    predictedIntent: item.prediction.intent,
    predictedConfidence: item.prediction.confidenceScores.intent ?? 0,
    groundTruthIntent: item.groundTruth.intent,
  }));

  const confidenceObservations: ConfidenceObservation[] = fieldResultsPerItem
    .flat()
    .filter((r) => r.predictedConfidence !== null)
    .map((r) => ({ confidence: r.predictedConfidence as number, correct: r.correct }));

  const allFieldResultsCorrectCount = fieldResultsPerItem.flat().filter((r) => r.correct).length;
  const allFieldResultsTotal = fieldResultsPerItem.flat().length;

  const failures = items.flatMap((item, index) =>
    fieldResultsPerItem[index]!.filter((r) => !r.correct).map((r) => ({
      datasetItemId: item.datasetItemId,
      field: r.field,
      predictedValue: r.predictedValue,
      groundTruthValue: r.groundTruthValue,
    })),
  );

  return {
    runMetadata,
    benchmarkStatus,
    itemCount: items.length,
    overallAccuracy:
      allFieldResultsTotal === 0 ? null : allFieldResultsCorrectCount / allFieldResultsTotal,
    fieldAccuracy: summarizeFieldAccuracy(fieldResultsPerItem),
    intentMetrics: evaluateIntentClassification(
      intentPredictions,
      runMetadata.thresholds[0] ?? 0.6,
    ),
    confidenceCalibration: {
      buckets: computeConfidenceBuckets(confidenceObservations),
      expectedCalibrationError: computeExpectedCalibrationError(confidenceObservations),
      maximumCalibrationError: computeMaximumCalibrationError(confidenceObservations),
      brierScore: computeBrierScore(confidenceObservations),
    },
    recordLevelMetrics: evaluateRecordLevelConfidence(
      items.map((item) => ({ prediction: item.prediction, groundTruth: item.groundTruth })),
    ),
    thresholdAnalysis: analyzeThresholds(confidenceObservations, runMetadata.thresholds),
    failures,
  };
}

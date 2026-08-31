import { classifyRecordConfidence, computeRecordConfidence } from '../compute-record-confidence';
import type { RecordConfidenceClassification } from '../compute-record-confidence';
import { evaluateFields } from './field-level-evaluation';
import type { GroundTruthCandidate } from './evaluation-dataset';
import type { TransactionExtractionCandidate } from '../transaction-extraction-schema';

/**
 * TASK-AI-004's "RECORD-LEVEL EVALUATION" — reuses TASK-AI-003's
 * `computeRecordConfidence`/`classifyRecordConfidence` verbatim (not
 * reimplemented) and asks the calibration question §4.6.2 itself poses:
 * do the `auto_commit` / `flagged_review` / `draft_pending_clarification`
 * bands actually correspond to real correctness?
 *
 * "Actually correct" for a whole record is defined as every evaluated
 * field matching ground truth (`evaluateFields`, reused from field-level
 * evaluation — a record is only as correct as its least correct field,
 * the same "minimum, not average" philosophy §4.6.2 already applies to
 * confidence itself).
 *
 * Deliberately reports per-band *accuracy* (a record either was or wasn't
 * fully correct — one outcome per record, one rate per band), not
 * precision/recall/F1: those metrics need a meaningful positive/negative
 * class distinction across an unordered label set, but
 * `auto_commit`/`flagged_review`/`draft_pending_clarification` are three
 * ordinal confidence tiers over the same single question ("was this
 * correct?") — accuracy-within-band is the metric that actually answers
 * NFR-AI-004, precision/recall would not be mathematically meaningful here.
 */
export interface RecordEvaluationItem {
  prediction: TransactionExtractionCandidate;
  groundTruth: GroundTruthCandidate;
}

export interface RecordBandAccuracy {
  classification: RecordConfidenceClassification;
  total: number;
  actuallyCorrect: number;
  accuracy: number | null;
}

export interface RecordLevelEvaluationResult {
  total: number;
  bandAccuracy: readonly RecordBandAccuracy[];
}

function isRecordFullyCorrect(
  prediction: TransactionExtractionCandidate,
  groundTruth: GroundTruthCandidate,
): boolean {
  return evaluateFields(prediction, groundTruth).every((r) => r.correct);
}

const CLASSIFICATIONS: readonly RecordConfidenceClassification[] = [
  'auto_commit',
  'flagged_review',
  'draft_pending_clarification',
];

export function evaluateRecordLevelConfidence(
  items: readonly RecordEvaluationItem[],
): RecordLevelEvaluationResult {
  const classified = items.map(({ prediction, groundTruth }) => ({
    classification: classifyRecordConfidence(computeRecordConfidence(prediction)),
    actuallyCorrect: isRecordFullyCorrect(prediction, groundTruth),
  }));

  const bandAccuracy: RecordBandAccuracy[] = CLASSIFICATIONS.map((classification) => {
    const inBand = classified.filter((c) => c.classification === classification);
    const actuallyCorrect = inBand.filter((c) => c.actuallyCorrect).length;
    return {
      classification,
      total: inBand.length,
      actuallyCorrect,
      accuracy: inBand.length === 0 ? null : actuallyCorrect / inBand.length,
    };
  });

  return { total: items.length, bandAccuracy };
}

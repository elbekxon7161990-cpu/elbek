import type { ConfidenceObservation } from './confidence-calibration';

/**
 * TASK-AI-004's "THRESHOLD ANALYSIS" — sweeps a set of candidate confidence
 * thresholds against already-scored `ConfidenceObservation`s (reused from
 * `confidence-calibration.ts`, not a new observation shape) to show the
 * accept/reject trade-off at each one. Purely evidentiary: per this task's
 * own instruction, "Do not change the production threshold automatically."
 * FR-AI-031's admin-adjustable threshold remains the only mechanism that
 * actually changes production behavior.
 */
export interface ThresholdAnalysisResult {
  threshold: number;
  acceptedCount: number;
  rejectedCount: number;
  /** Accepted (confidence >= threshold) but actually incorrect — the cost of setting the threshold this low. */
  falsePositives: number;
  /** Rejected (confidence < threshold) but was actually correct — the cost of setting the threshold this high (unnecessary clarification). */
  falseNegatives: number;
  accuracyAmongAccepted: number | null;
  rejectionRate: number;
}

export function analyzeThresholds(
  observations: readonly ConfidenceObservation[],
  thresholds: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9],
): readonly ThresholdAnalysisResult[] {
  return thresholds.map((threshold) => {
    const accepted = observations.filter((o) => o.confidence >= threshold);
    const rejected = observations.filter((o) => o.confidence < threshold);
    const falsePositives = accepted.filter((o) => !o.correct).length;
    const falseNegatives = rejected.filter((o) => o.correct).length;

    return {
      threshold,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      falsePositives,
      falseNegatives,
      accuracyAmongAccepted:
        accepted.length === 0 ? null : accepted.filter((o) => o.correct).length / accepted.length,
      rejectionRate: observations.length === 0 ? 0 : rejected.length / observations.length,
    };
  });
}

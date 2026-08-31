/**
 * TASK-AI-004 (Chapter 4 §4.27.3 "Confidence calibration: Correlation
 * between reported confidence band and actual correctness rate", NFR-AI-004
 * "a field marked 0.9 confidence should be correct ≥ ~90% of the time").
 *
 * Generic over any binary correct/incorrect prediction paired with a
 * self-reported confidence — reused identically by field-level, intent-
 * level, and record-level evaluation (§4.27.3's three "dimensions" all
 * reduce to this same statistical question, just applied to a different
 * unit of prediction) rather than three separate, drifting copies of the
 * same bucket/ECE/MCE math.
 */
export interface ConfidenceObservation {
  confidence: number;
  correct: boolean;
}

export interface ConfidenceBucket {
  /** e.g. "0.6-0.7" */
  label: string;
  rangeStart: number;
  rangeEnd: number;
  sampleSize: number;
  averagePredictedConfidence: number | null;
  actualAccuracy: number | null;
  /** |averagePredictedConfidence - actualAccuracy| — undefined (null) when the bucket has no samples. */
  calibrationError: number | null;
}

const BUCKET_WIDTH = 0.1;
const BUCKET_COUNT = 10;

/**
 * Ten fixed-width buckets, [0.0-0.1) ... [0.9-1.0] (the final bucket is
 * closed on both ends so a perfect 1.0 confidence has a home) — the
 * standard calibration-diagram binning scheme this task's spec names
 * explicitly.
 */
/**
 * Assigns a confidence value to a bucket index [0-9] by rounding to whole
 * tenths first (`* 10`, epsilon-guarded, then floored) rather than
 * comparing against per-bucket float boundaries computed via repeated
 * multiplication/addition (`i * 0.1`) — the latter is vulnerable to IEEE
 * 754 drift (e.g. `6 * 0.1 === 0.6000000000000001`), which can silently
 * exclude an exact boundary value like `0.6` from its correct bucket.
 */
function bucketIndexFor(confidence: number): number {
  const scaled = Math.floor(confidence * 10 + 1e-9);
  return Math.min(Math.max(scaled, 0), BUCKET_COUNT - 1);
}

export function computeConfidenceBuckets(
  observations: readonly ConfidenceObservation[],
): ConfidenceBucket[] {
  const buckets: ConfidenceBucket[] = [];
  const byIndex: ConfidenceObservation[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const obs of observations) {
    byIndex[bucketIndexFor(obs.confidence)]!.push(obs);
  }

  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    const rangeStart = i * BUCKET_WIDTH;
    const rangeEnd = rangeStart + BUCKET_WIDTH;
    const inBucket = byIndex[i]!;

    const sampleSize = inBucket.length;
    const averagePredictedConfidence =
      sampleSize === 0 ? null : inBucket.reduce((sum, o) => sum + o.confidence, 0) / sampleSize;
    const actualAccuracy =
      sampleSize === 0 ? null : inBucket.filter((o) => o.correct).length / sampleSize;
    const calibrationError =
      averagePredictedConfidence === null || actualAccuracy === null
        ? null
        : Math.abs(averagePredictedConfidence - actualAccuracy);

    buckets.push({
      label: `${rangeStart.toFixed(1)}-${rangeEnd.toFixed(1)}`,
      rangeStart,
      rangeEnd,
      sampleSize,
      averagePredictedConfidence,
      actualAccuracy,
      calibrationError,
    });
  }

  return buckets;
}

/**
 * Expected Calibration Error — the sample-size-weighted average of each
 * non-empty bucket's calibration error. Standard choice for summarizing
 * calibration across a whole confidence range into one number; weighting
 * by bucket size prevents a bucket with 2 samples from counting as much as
 * one with 200. Returns `null` (not 0) when there are no observations at
 * all — an absent metric must never be reported as a perfect score.
 */
export function computeExpectedCalibrationError(
  observations: readonly ConfidenceObservation[],
): number | null {
  if (observations.length === 0) {
    return null;
  }
  const buckets = computeConfidenceBuckets(observations);
  const weightedSum = buckets.reduce((sum, b) => sum + (b.calibrationError ?? 0) * b.sampleSize, 0);
  return weightedSum / observations.length;
}

/**
 * Maximum Calibration Error — the worst single-bucket calibration error,
 * unweighted by sample size (deliberately, unlike ECE): MCE exists
 * specifically to surface the single most-miscalibrated region even if
 * it's a small bucket, which a weighted average would dilute away.
 */
export function computeMaximumCalibrationError(
  observations: readonly ConfidenceObservation[],
): number | null {
  if (observations.length === 0) {
    return null;
  }
  const buckets = computeConfidenceBuckets(observations).filter((b) => b.calibrationError !== null);
  if (buckets.length === 0) {
    return null;
  }
  return Math.max(...buckets.map((b) => b.calibrationError as number));
}

/**
 * Brier score — mean squared error between the predicted confidence and
 * the binary outcome (1 = correct, 0 = incorrect). Appropriate here
 * specifically because every calibration question this module answers is
 * ultimately binary ("was this field/intent/record correct?") with a
 * single scalar probability estimate (the reported confidence) — Brier
 * score is the standard proper scoring rule for exactly that shape of
 * prediction. It is NOT computed for anything without a well-defined
 * correct/incorrect outcome (e.g. there is no Brier score for "which of
 * 24 intents" in isolation — that is what the confusion matrix and
 * per-intent precision/recall are for instead, see `intent-evaluation.ts`).
 */
export function computeBrierScore(observations: readonly ConfidenceObservation[]): number | null {
  if (observations.length === 0) {
    return null;
  }
  const sumSquaredError = observations.reduce(
    (sum, o) => sum + (o.confidence - (o.correct ? 1 : 0)) ** 2,
    0,
  );
  return sumSquaredError / observations.length;
}

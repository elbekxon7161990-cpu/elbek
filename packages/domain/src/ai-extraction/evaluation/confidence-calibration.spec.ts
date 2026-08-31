import { describe, expect, it } from 'vitest';

import {
  computeBrierScore,
  computeConfidenceBuckets,
  computeExpectedCalibrationError,
  computeMaximumCalibrationError,
} from './confidence-calibration';
import type { ConfidenceObservation } from './confidence-calibration';

function perfectlyCalibratedObservations(): ConfidenceObservation[] {
  // 10 observations at confidence 0.9, exactly 9 correct (90%) — a textbook perfectly-calibrated bucket.
  return [
    ...Array.from({ length: 9 }, () => ({ confidence: 0.9, correct: true })),
    { confidence: 0.9, correct: false },
  ];
}

describe('computeConfidenceBuckets', () => {
  it('sorts observations into the 10 fixed-width [0.0-0.1) ... [0.9-1.0] buckets', () => {
    const buckets = computeConfidenceBuckets([{ confidence: 0.95, correct: true }]);

    expect(buckets).toHaveLength(10);
    expect(buckets[9]?.label).toBe('0.9-1.0');
    expect(buckets[9]?.sampleSize).toBe(1);
  });

  it('assigns a 0.0 confidence observation to the first bucket', () => {
    const buckets = computeConfidenceBuckets([{ confidence: 0.0, correct: false }]);

    expect(buckets[0]?.sampleSize).toBe(1);
  });

  it('assigns a 1.0 confidence observation to the last bucket (closed on both ends)', () => {
    const buckets = computeConfidenceBuckets([{ confidence: 1.0, correct: true }]);

    expect(buckets[9]?.sampleSize).toBe(1);
  });

  it('handles the exact bucket boundary correctly (0.6 belongs to [0.6-0.7), not [0.5-0.6))', () => {
    const buckets = computeConfidenceBuckets([{ confidence: 0.6, correct: true }]);

    expect(buckets[5]?.sampleSize).toBe(0); // [0.5-0.6)
    expect(buckets[6]?.sampleSize).toBe(1); // [0.6-0.7)
  });

  it('reports null (not 0) for average confidence / accuracy / calibration error on an empty bucket', () => {
    const buckets = computeConfidenceBuckets([]);

    for (const bucket of buckets) {
      expect(bucket.sampleSize).toBe(0);
      expect(bucket.averagePredictedConfidence).toBeNull();
      expect(bucket.actualAccuracy).toBeNull();
      expect(bucket.calibrationError).toBeNull();
    }
  });

  it('computes perfect calibration (avg confidence ≈ actual accuracy, near-zero calibration error)', () => {
    const buckets = computeConfidenceBuckets(perfectlyCalibratedObservations());
    const bucket = buckets[9]; // [0.9-1.0]

    expect(bucket?.sampleSize).toBe(10);
    expect(bucket?.averagePredictedConfidence).toBeCloseTo(0.9, 5);
    expect(bucket?.actualAccuracy).toBeCloseTo(0.9, 5);
    expect(bucket?.calibrationError).toBeCloseTo(0, 5);
  });

  it('computes overconfidence (high reported confidence, low actual accuracy)', () => {
    const overconfident: ConfidenceObservation[] = [
      ...Array.from({ length: 9 }, () => ({ confidence: 0.95, correct: false })),
      { confidence: 0.95, correct: true },
    ];
    const buckets = computeConfidenceBuckets(overconfident);
    const bucket = buckets[9];

    expect(bucket?.averagePredictedConfidence).toBeCloseTo(0.95, 5);
    expect(bucket?.actualAccuracy).toBeCloseTo(0.1, 5);
    expect(bucket?.calibrationError).toBeCloseTo(0.85, 5);
  });

  it('computes underconfidence (low reported confidence, high actual accuracy)', () => {
    const underconfident: ConfidenceObservation[] = Array.from({ length: 10 }, () => ({
      confidence: 0.2,
      correct: true,
    }));
    const buckets = computeConfidenceBuckets(underconfident);
    const bucket = buckets[2]; // [0.2-0.3)

    expect(bucket?.averagePredictedConfidence).toBeCloseTo(0.2, 5);
    expect(bucket?.actualAccuracy).toBe(1);
    expect(bucket?.calibrationError).toBeCloseTo(0.8, 5);
  });
});

describe('computeExpectedCalibrationError', () => {
  it('returns null (not 0) for an empty observation set', () => {
    expect(computeExpectedCalibrationError([])).toBeNull();
  });

  it('is near-zero for perfectly calibrated observations', () => {
    expect(computeExpectedCalibrationError(perfectlyCalibratedObservations())).toBeCloseTo(0, 5);
  });

  it('is high for systematically overconfident observations', () => {
    const overconfident: ConfidenceObservation[] = Array.from({ length: 10 }, () => ({
      confidence: 0.95,
      correct: false,
    }));

    expect(computeExpectedCalibrationError(overconfident)).toBeCloseTo(0.95, 5);
  });

  it('weights buckets by sample size', () => {
    const observations: ConfidenceObservation[] = [
      // A huge, perfectly-calibrated bucket...
      ...Array.from({ length: 90 }, () => ({ confidence: 0.9, correct: true })),
      ...Array.from({ length: 10 }, () => ({ confidence: 0.9, correct: false })),
      // ...and one tiny, badly-miscalibrated bucket.
      { confidence: 0.1, correct: true },
    ];

    // ECE should be dominated by the 100-sample bucket (near 0), not the 1-sample outlier.
    expect(computeExpectedCalibrationError(observations)).toBeLessThan(0.2);
  });
});

describe('computeMaximumCalibrationError', () => {
  it('returns null for an empty observation set', () => {
    expect(computeMaximumCalibrationError([])).toBeNull();
  });

  it('surfaces the single worst bucket even when it has few samples (unweighted, unlike ECE)', () => {
    const observations: ConfidenceObservation[] = [
      // A large, well-calibrated bucket (small calibration error, high weight).
      ...Array.from({ length: 90 }, () => ({ confidence: 0.9, correct: true })),
      ...Array.from({ length: 10 }, () => ({ confidence: 0.9, correct: false })),
      // A tiny, badly-miscalibrated bucket: confidence 0.05, but always wrong -> calibration error only 0.05 (small on its own)...
      { confidence: 0.05, correct: false },
      // ...so make a genuinely bad tiny bucket: high reported confidence, always wrong.
      { confidence: 0.35, correct: false },
    ];

    const mce = computeMaximumCalibrationError(observations);
    // Bucket [0.3-0.4): avgConfidence 0.35, accuracy 0 -> calibration error 0.35 — the worst of all buckets here,
    // despite having only 1 sample vs. the 100-sample [0.9-1.0) bucket.
    expect(mce).toBeCloseTo(0.35, 5);
  });
});

describe('computeBrierScore', () => {
  it('returns null for an empty observation set', () => {
    expect(computeBrierScore([])).toBeNull();
  });

  it('is 0 for a perfect predictor (confidence 1.0 always correct, confidence 0.0 always wrong)', () => {
    const observations: ConfidenceObservation[] = [
      { confidence: 1.0, correct: true },
      { confidence: 0.0, correct: false },
    ];

    expect(computeBrierScore(observations)).toBe(0);
  });

  it('is 1 for the worst possible predictor (confidence 1.0 always wrong)', () => {
    expect(computeBrierScore([{ confidence: 1.0, correct: false }])).toBe(1);
  });

  it('is 0.25 for a maximally uncertain, uninformative predictor (confidence 0.5 either way)', () => {
    const observations: ConfidenceObservation[] = [
      { confidence: 0.5, correct: true },
      { confidence: 0.5, correct: false },
    ];

    expect(computeBrierScore(observations)).toBeCloseTo(0.25, 5);
  });
});

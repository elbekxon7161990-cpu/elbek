import { describe, expect, it } from 'vitest';

import { analyzeThresholds } from './threshold-analysis';
import type { ConfidenceObservation } from './confidence-calibration';

const OBSERVATIONS: ConfidenceObservation[] = [
  { confidence: 0.95, correct: true },
  { confidence: 0.85, correct: true },
  { confidence: 0.75, correct: false }, // a confident-but-wrong prediction
  { confidence: 0.55, correct: true }, // a correct prediction the default threshold would still reject
  { confidence: 0.3, correct: false },
];

describe('analyzeThresholds', () => {
  it('sweeps the default thresholds (0.5, 0.6, 0.7, 0.8, 0.9)', () => {
    const results = analyzeThresholds(OBSERVATIONS);

    expect(results.map((r) => r.threshold)).toEqual([0.5, 0.6, 0.7, 0.8, 0.9]);
  });

  it('accepts everything at or above the threshold, rejects everything below', () => {
    const [result] = analyzeThresholds(OBSERVATIONS, [0.8]);

    expect(result?.acceptedCount).toBe(2); // 0.95, 0.85
    expect(result?.rejectedCount).toBe(3);
  });

  it('counts an accepted-but-wrong prediction as a false positive', () => {
    const [result] = analyzeThresholds(OBSERVATIONS, [0.7]);

    // Accepted at >=0.7: 0.95(correct), 0.85(correct), 0.75(WRONG) -> 1 false positive.
    expect(result?.falsePositives).toBe(1);
  });

  it('counts a rejected-but-actually-correct prediction as a false negative', () => {
    const [result] = analyzeThresholds(OBSERVATIONS, [0.6]);

    // Rejected at <0.6: 0.55(correct -> false negative), 0.3(wrong).
    expect(result?.falseNegatives).toBe(1);
  });

  it('computes accuracy among accepted predictions only', () => {
    const [result] = analyzeThresholds(OBSERVATIONS, [0.8]);

    expect(result?.accuracyAmongAccepted).toBe(1); // both 0.95 and 0.85 were correct
  });

  it('returns null accuracyAmongAccepted when nothing is accepted at that threshold', () => {
    const [result] = analyzeThresholds(OBSERVATIONS, [0.99]);

    expect(result?.acceptedCount).toBe(0);
    expect(result?.accuracyAmongAccepted).toBeNull();
  });

  it('computes rejection rate as a fraction of the whole set', () => {
    const [result] = analyzeThresholds(OBSERVATIONS, [0.9]);

    expect(result?.rejectedCount).toBe(4);
    expect(result?.rejectionRate).toBeCloseTo(0.8, 5);
  });

  it('a higher threshold never accepts more than a lower one (monotonicity)', () => {
    const results = analyzeThresholds(OBSERVATIONS, [0.5, 0.9]);

    expect(results[0]?.acceptedCount).toBeGreaterThanOrEqual(results[1]?.acceptedCount ?? 0);
  });

  it('handles an empty observation set without error', () => {
    const results = analyzeThresholds([], [0.6]);

    expect(results[0]?.acceptedCount).toBe(0);
    expect(results[0]?.rejectionRate).toBe(0);
  });

  it('never changes the observations passed in (no mutation, purely evidentiary)', () => {
    const copy = [...OBSERVATIONS];
    analyzeThresholds(OBSERVATIONS);

    expect(OBSERVATIONS).toEqual(copy);
  });
});

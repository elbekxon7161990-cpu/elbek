import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUDGET_THRESHOLDS,
  evaluateBudgetThresholdCrossing,
} from './evaluate-budget-threshold-crossing';

describe('evaluateBudgetThresholdCrossing (Chapter 19 Scenario C)', () => {
  it('fires 75% when utilization moves from below 75% to at-or-above it', () => {
    expect(evaluateBudgetThresholdCrossing(70, 75)).toEqual([75]);
    expect(evaluateBudgetThresholdCrossing(70, 80)).toEqual([75]);
  });

  it('does NOT fire 90% for a transaction that leaves utilization above 90% without crossing it (96% -> 104% already fired 90% earlier)', () => {
    // Scenario C: "utilization to 96% -> Second threshold (90%) already
    // fired earlier when crossed" -- evaluated here as the single
    // transaction that pushed 89% -> 96%, which crosses 90% exactly once.
    expect(evaluateBudgetThresholdCrossing(89, 96)).toEqual([90]);
    // A LATER transaction that pushes 96% -> 104% must NOT re-fire 90% --
    // it was already above 90% before this transaction.
    expect(evaluateBudgetThresholdCrossing(96, 104)).toEqual([100]);
  });

  it('does not confuse "being above" with "crossing": a transaction that stays within the same above-threshold band fires nothing', () => {
    expect(evaluateBudgetThresholdCrossing(92, 95)).toEqual([]);
    expect(evaluateBudgetThresholdCrossing(101, 150)).toEqual([]);
  });

  it('fires 100% exactly once for the transaction that pushes utilization to or past 100%', () => {
    expect(evaluateBudgetThresholdCrossing(96, 104)).toEqual([100]);
  });

  it('fires multiple thresholds at once when a single transaction jumps past more than one', () => {
    expect(evaluateBudgetThresholdCrossing(60, 130)).toEqual([75, 90, 100]);
  });

  it("fires nothing when utilization decreases (an edit/refund is out of this synchronous hook's scope, but the pure function itself must never fire on a decrease)", () => {
    expect(evaluateBudgetThresholdCrossing(96, 80)).toEqual([]);
  });

  it('fires nothing when utilization is unchanged', () => {
    expect(evaluateBudgetThresholdCrossing(80, 80)).toEqual([]);
  });

  it('a transaction landing exactly ON a threshold counts as crossing it (>=, not >)', () => {
    expect(evaluateBudgetThresholdCrossing(74, 75)).toEqual([75]);
    expect(evaluateBudgetThresholdCrossing(89.9, 90)).toEqual([90]);
  });

  it('DEFAULT_BUDGET_THRESHOLDS is exactly [75, 90, 100], ascending', () => {
    expect(DEFAULT_BUDGET_THRESHOLDS).toEqual([75, 90, 100]);
  });
});

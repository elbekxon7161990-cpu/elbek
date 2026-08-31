/**
 * TASK-FIN-003 (FR-BUD-005, §8.22.2 `BudgetThresholdCrossed`). MVP hardcodes
 * the PRD-stated defaults — "configurable thresholds (default: 75%, 90%,
 * 100%...)" — the same "P2 configurability; MVP hardcodes the sensible
 * default" pattern BR-BUD-001 already uses for included-transaction-types.
 * Ordered ascending; callers must not assume any other order.
 */
export const DEFAULT_BUDGET_THRESHOLDS: readonly number[] = [75, 90, 100];

/**
 * FR-BUD-005/Chapter 19 Scenario C — a threshold "crosses" only when
 * utilization moves from strictly below it to at-or-above it as a DIRECT
 * result of the transaction being evaluated; a transaction that leaves
 * utilization already-above a threshold (e.g. 96% -> 104%, still above 90%
 * both before and after) does NOT re-cross 90% — only the newly-reached
 * threshold(s) fire. "Any subsequent overage in the same period is a single
 * follow-up, not repeated spam" (FR-BUD-005) — once 100% has fired, no
 * threshold in `DEFAULT_BUDGET_THRESHOLDS` can ever fire again for the same
 * evaluation, since utilization can only climb past thresholds it has
 * already climbed past. Returns thresholds in ascending order (a single
 * transaction can legitimately cross more than one threshold at once, e.g.
 * a budget jumping from 60% to 130% in one transaction crosses 75%, 90%,
 * AND 100% simultaneously — each requires its own dedup-logged notification,
 * per FR-FIN-048's "emitted exactly once per triggering state transition").
 */
export function evaluateBudgetThresholdCrossing(
  utilizationBeforePercent: number,
  utilizationAfterPercent: number,
  thresholds: readonly number[] = DEFAULT_BUDGET_THRESHOLDS,
): readonly number[] {
  if (utilizationAfterPercent <= utilizationBeforePercent) {
    return [];
  }
  return thresholds.filter(
    (threshold) => utilizationBeforePercent < threshold && utilizationAfterPercent >= threshold,
  );
}

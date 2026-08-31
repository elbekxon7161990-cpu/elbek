/**
 * TASK-FIN-004 (FR-FIN-013, §8.9.2/§8.14.5) — "milestone notification at
 * configurable thresholds (default: 25%, 50%, 75%, 100%)". MVP hardcodes the
 * PRD-stated defaults, mirroring `evaluateBudgetThresholdCrossing`'s own
 * identical "P2 configurability; MVP hardcodes the sensible default"
 * restraint (FR-BUD-005's analogous case) — not this task's job to build a
 * per-user configuration mechanism. Ordered ascending; callers must not
 * assume any other order.
 */
export const DEFAULT_GOAL_MILESTONE_THRESHOLDS: readonly number[] = [25, 50, 75, 100];

/**
 * Unlike `evaluateBudgetThresholdCrossing` (which compares a BEFORE and
 * AFTER percentage), this compares the persisted dedup marker
 * (`SavingsGoal.lastMilestoneFired` — the highest threshold already
 * notified for, or `null`) against the current progress percentage. This is
 * the more robust of the two equivalent designs: it reads the marker that
 * will actually be persisted and atomically updated (TASK-FIN-004 Stage F,
 * mirroring `BudgetNotificationLog`'s own dedup precedent), rather than
 * requiring the caller to separately track and pass a "before" percentage
 * that could drift from what was actually persisted under concurrent
 * contributions.
 *
 * Returns every threshold strictly greater than `lastMilestoneFired` (or
 * greater than 0 if `null`) and less than or equal to
 * `currentProgressPercent`, in ascending order — a single large contribution
 * can legitimately cross more than one threshold at once (e.g. 10% -> 80%
 * crosses 25%, 50%, AND 75% simultaneously), the same multi-threshold
 * scenario `evaluateBudgetThresholdCrossing`'s own doc comment describes for
 * Budget.
 */
export function detectNewlyCrossedGoalMilestones(
  lastMilestoneFired: number | null,
  currentProgressPercent: number,
  thresholds: readonly number[] = DEFAULT_GOAL_MILESTONE_THRESHOLDS,
): readonly number[] {
  const floor = lastMilestoneFired ?? 0;
  if (currentProgressPercent <= floor) {
    return [];
  }
  return thresholds.filter((threshold) => threshold > floor && currentProgressPercent >= threshold);
}

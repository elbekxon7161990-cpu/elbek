/**
 * TASK-FIN-004 (Stage E, §8.14.5, FR-FIN-043 generalized) — mirrors
 * `AccountBalanceUnavailableError`'s exact reasoning: thrown by
 * `computeSavingsGoalProgress` when a contribution/linked-transfer
 * attributed to the goal is in a currency other than the goal's own, and no
 * exchange rate (not even a historical fallback per FR-FIN-029) exists for
 * that pair as of the transaction's date. The already-computed partial sum
 * is discarded, never returned — an incomplete progress figure is worse
 * than no figure, since it looks valid (understating real progress).
 *
 * Callers computing progress for DISPLAY purposes should let this propagate
 * (FR-FIN-043's fail-loud principle). The one exception, disclosed in
 * `evaluate-savings-goal-progress-on-contribution-commit.ts`'s own doc
 * comment: the synchronous commit-hook triggered by creating a NEW
 * contribution/transfer deliberately catches this specific error and skips
 * milestone evaluation for that commit rather than rejecting the
 * contribution itself — mirroring FR-EXP-004's own "a sanity/derived check
 * never blocks the primary financial action" principle, not a silent
 * zero-substitution.
 */
export class GoalProgressUnavailableError extends Error {
  constructor(goalId: string, fromCurrency: string, toCurrency: string) {
    super(
      `Cannot compute progress for savings goal "${goalId}": no exchange rate available for ${fromCurrency} -> ${toCurrency} for at least one attributed transaction (not even a historical fallback). Failing loudly per FR-FIN-043 rather than silently returning incomplete progress.`,
    );
    this.name = 'GoalProgressUnavailableError';
  }
}

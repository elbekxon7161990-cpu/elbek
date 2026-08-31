/**
 * DI token for @afa/infrastructure's implementation, same Symbol-token
 * pattern as USER_REPOSITORY.
 */
export const EXPENSE_HISTORY_REPOSITORY = Symbol('EXPENSE_HISTORY_REPOSITORY');

/**
 * FR-EXP-004 — the single query the large-amount sanity check needs: the
 * user's trailing-90-day average `EXPENSE` amount, same-currency only.
 *
 * Scope notes (the PRD states the 10x-threshold rule but not every one of
 * these mechanics explicitly — each is a deliberate, documented reading,
 * not an invented rule):
 * - "average expense" (FR-EXP-004's own wording) → `transactionType =
 *   'EXPENSE'` only; SALARY/INCOME/REFUND never enter this average.
 * - Soft-deleted transactions are excluded — the established convention
 *   for every other query in this codebase (`deletedAt IS NULL`), and a
 *   deleted expense isn't part of the user's real spending history.
 * - Same-currency only, no cross-currency conversion: comparing "amount in
 *   currency X" against "average in currency Y" would require an FX rate,
 *   which is TASK-FIN-007's explicit scope, not TASK-FIN-001's — see
 *   BR-INC-002's identical reasoning. A user with expenses in multiple
 *   currencies gets a separate average per currency.
 * - The 90-day window is anchored to `asOf` (the moment of evaluation) and
 *   measured against each historical expense's own `transactionDate`
 *   (backdating-safe — an expense entered today for last month doesn't
 *   shift what "the last 90 days" means).
 * - No history in that window/currency → `null` (nothing to compare
 *   against; the caller must never flag on `null`, per FR-EXP-004's own
 *   "never blocked, never a false positive" spirit).
 */
export interface ExpenseHistoryRepository {
  getTrailingAverageExpenseAmount(
    userId: string,
    currency: string,
    asOf: Date,
  ): Promise<string | null>;
}

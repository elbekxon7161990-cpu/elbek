import type { Budget, BudgetPeriodType, BudgetScopeType } from '../entities/budget.entity';

export const BUDGET_REPOSITORY = Symbol('BUDGET_REPOSITORY');

export interface NewBudgetData {
  userId: string;
  scopeType: BudgetScopeType;
  categoryId: string | null;
  limitAmount: string;
  currency: string;
  periodType: BudgetPeriodType;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * FR-BUD-007 — "editing (limit amount, category)." `periodType`/`currency`/
 * `scopeType` are not editable (changing them mid-period would make
 * `currentPeriodStart`/`End` and any already-fired `BudgetNotificationLog`
 * rows meaningless) — not a PRD requirement, so not built. `categoryId` here
 * only ever REPLACES which category a `'category'`-scope budget targets —
 * FR-BUD-007 does not say a budget's scope itself (category <-> overall) is
 * editable, so `null` (which would flip `scopeType` to `'overall'`,
 * `chk_budgets_scope_category`) is deliberately not an accepted value here;
 * converting scope is not a documented requirement and is not invented.
 */
export interface BudgetEditableFields {
  limitAmount?: string;
  categoryId?: string;
}

/** §8.14.4's `budget_utilization` formula output, plus the display fields FR-BUD-006's `/budget` view needs (§8.4.8 AC-BUD-001's own worked example: "13.3% utilized ... with the correct remaining amount and days left in the month"). `usedAmount`/`remainingAmount` are canonical decimal strings in `budget.currency` (DB-P3/FR-DB-027); `utilizationPercent` is a derived display/comparison figure, not itself a monetary amount. */
export interface BudgetUtilization {
  budget: Budget;
  usedAmount: string;
  utilizationPercent: number;
  remainingAmount: string;
  daysRemainingInPeriod: number;
}

/**
 * TASK-FIN-003 (Chapter 8 §8.4) — port for the `budgets`/`budget_notification_log`
 * tables (§13.7), following the dedicated-repository precedent `DebtRepository`
 * already established (a `Budget` is not a `Transaction`, and BR-BUD-*'s own
 * rules require the two to stay wholly independent read/write paths).
 */
export interface BudgetRepository {
  findById(id: string): Promise<Budget | null>;

  /** Scoped to one user, excludes soft-deleted rows — for `/budget` (FR-BUD-006). Includes `'paused'` budgets (no PRD requirement excludes them from the view; only `deletedAt` excludes). */
  findActiveByUserId(userId: string): Promise<Budget[]>;

  /**
   * Validates the not-yet-persisted budget (`Budget.validateNew`) BEFORE
   * any database write, mirroring `DebtRepository.create()`'s own
   * atomic-validation-first discipline. Throws `DuplicateBudgetError`
   * (§8.4.7) — never a generic constraint-violation error — when the
   * caller's `(userId, categoryId, periodType)`/`(userId, periodType)`
   * partial-unique index is already occupied by a non-deleted budget.
   */
  create(data: NewBudgetData): Promise<Budget>;

  /**
   * FR-BUD-007. `userId` is part of the WHERE clause itself (an atomic
   * conditional `UPDATE ... WHERE id = ? AND user_id = ? AND deleted_at IS
   * NULL`), not a separate pre-fetch-then-compare check — ownership is
   * enforced at the repository layer IN ADDITION TO database-level RLS
   * (defense-in-depth: a client-supplied `budgetId` is never trusted alone,
   * even under RLS), mirroring `DebtRepository.forgive()`'s own atomic
   * conditional-`WHERE` ownership pattern. Returns `null` if the budget does
   * not exist, is already soft-deleted, or is not owned by `userId`.
   */
  update(id: string, userId: string, changes: BudgetEditableFields): Promise<Budget | null>;

  /** FR-BUD-007 — "deletion requiring explicit confirmation" is the application layer's own concern (the confirmation UX itself); this method performs the actual soft-delete once confirmed. Same atomic-conditional-`WHERE` ownership enforcement as `update()`. Returns `null` if already deleted or not found/owned. */
  softDelete(id: string, userId: string): Promise<Budget | null>;

  /**
   * §8.14.4's authoritative `budget_utilization` formula (FR-FIN-031 —
   * "implemented as a single shared function/service invoked by every
   * consumer... no consumer may reimplement the formula independently"),
   * computed live via SQL aggregation against real `Committed`-state
   * `EXPENSE` transactions (FR-BUD-004, NFR-BUD-001's <300ms p95 target) —
   * never cached, never computed in application code. `userId` is part of
   * the query's own WHERE clause (same ownership discipline as `update()`/
   * `softDelete()` above) — returns `null` if the budget does not exist or
   * is not owned by `userId`.
   */
  computeUtilization(
    budgetId: string,
    userId: string,
    asOf: Date,
  ): Promise<BudgetUtilization | null>;

  /** Same formula as `computeUtilization`, batched for every active budget the user owns — avoids an N-query round trip for `/budget`'s own list view. */
  computeUtilizationForAllActive(userId: string, asOf: Date): Promise<BudgetUtilization[]>;

  /**
   * NFR-BUD-002 ("< 15 minutes after period boundary, scheduled ... in
   * batched timezone groups, not a single global instant") — mirrors
   * `DebtReminderRepository.findCandidates`'s own N+1-by-design, per-user
   * iteration (this method's own implementation's doc comment explains why
   * a single cross-user query is not possible under RLS). Returns every
   * active budget whose `currentPeriodEnd` has already passed in ITS OWNER's
   * own local calendar date, as of `now`.
   */
  findDueForRollover(now: Date): Promise<Budget[]>;

  /**
   * FR-BUD-003 — atomically advances a budget to its next period,
   * "carrying forward the same limit ... reset[ting] the 'used' tracking to
   * zero" (the reset is implicit: utilization is always computed live
   * against the new `currentPeriodStart`, so there is no separate
   * `usedAmount` column to zero). Conditional on `currentPeriodEnd` still
   * matching the value the caller last read (optimistic concurrency —
   * mirrors `DebtRepository.forgive`'s own atomic conditional `UPDATE`),
   * so two concurrent rollover-batch runs can never double-advance the same
   * budget. Returns `null` if the budget no longer matches (already rolled
   * over by a concurrent run, deleted, or not found).
   */
  rolloverPeriod(
    budgetId: string,
    expectedCurrentPeriodEnd: Date,
    nextPeriodStart: Date,
    nextPeriodEnd: Date,
  ): Promise<Budget | null>;
}

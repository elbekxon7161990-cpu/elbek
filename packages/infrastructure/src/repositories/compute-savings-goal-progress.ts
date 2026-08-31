import type { Prisma, PrismaClient } from '@prisma/client';
import { GoalProgressUnavailableError, percentOf } from '@afa/domain';

import { formatDecimalAmount } from './format-decimal-amount';

/** Either the top-level extended client or an in-flight `$transaction` callback's `tx` — same shape `computeAccountBalance`/`computeBudgetUsedAmount` already rely on. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export interface SavingsGoalProgressScope {
  goalId: string;
  currency: string;
  targetAmount: string;
}

export interface SavingsGoalProgress {
  /** Canonical 2-decimal money string — the contributed total, already converted to `scope.currency`. */
  contributedAmount: string;
  /** Plain `number`, never a canonical decimal string — matches `detectNewlyCrossedGoalMilestones`/`SavingsGoal.evaluateCompletion`'s own established "percent is a comparison figure, not money" contract (the same treatment `evaluate-budget-thresholds-on-expense-commit.ts`'s own `percentOf` helper already established for budget utilization). Can exceed 100 (FR-FIN-014 — further contributions remain possible past the target). */
  progressPercent: number;
}

/**
 * TASK-FIN-004 (Stage E, §8.14.5) — "goal_progress(goal) =
 * Σ(GOAL_CONTRIBUTION.amount + linked TRANSFER.amount, converted to
 * goal.currency) / goal.target_amount". The ONE shared implementation
 * (FR-FIN-031) every consumer must call — mirrors `computeAccountBalance`'s
 * exact shape and cross-currency/fail-loud reasoning.
 *
 * Per §8.14.5's own literal wording, a linked `TRANSFER`'s contribution to
 * progress uses `TRANSFER.amount` (the SOURCE-side amount, in the
 * transfer's own `currency` column) — never `destinationAmount` — the same
 * "don't reinterpret the PRD's own explicit formula" discipline this task
 * has followed throughout. A standalone `GOAL_CONTRIBUTION` and a
 * goal-linked `TRANSFER` are mutually exclusive by construction
 * (TASK-FIN-004 Stage A's `Transaction` validation), so this single `SUM`
 * over both types never double-counts the same money movement (FR-FIN-012).
 *
 * Cross-currency (BR-FIN-006): identical `LATERAL`-join-against-`fx_rates`
 * pattern `computeAccountBalance` already established, using each
 * transaction's OWN date with the same exact-date/most-recent-prior-date
 * fallback. FR-FIN-043: if ANY attributed transaction has no rate at all for
 * its pair, the already-computed partial sum is discarded and
 * `GoalProgressUnavailableError` is thrown — never a silently-incomplete
 * progress figure that looks valid. (The one caller that deliberately
 * softens this — `evaluate-savings-goal-progress-on-contribution-commit.ts`'s
 * commit hook — catches this specific error itself; this function's own
 * contract is unconditional fail-loud, matching `computeAccountBalance`'s.)
 */
export async function computeSavingsGoalProgress(
  client: QueryableClient,
  scope: SavingsGoalProgressScope,
): Promise<SavingsGoalProgress> {
  const rows = await client.$queryRaw<
    Array<{ contributed: string; missing_rate_count: bigint; missing_rate_currency: string | null }>
  >`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN t.currency = ${scope.currency} THEN t.amount
          ELSE t.amount * fx.rate
        END
      ), 0)::text AS contributed,
      COUNT(*) FILTER (WHERE t.currency != ${scope.currency} AND fx.rate IS NULL) AS missing_rate_count,
      MIN(t.currency) FILTER (WHERE t.currency != ${scope.currency} AND fx.rate IS NULL) AS missing_rate_currency
    FROM transactions t
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = t.currency
        AND fxr.quote_currency = ${scope.currency}
        AND fxr.as_of_date <= t.transaction_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) fx ON t.currency != ${scope.currency}
    WHERE t.goal_id = ${scope.goalId}::uuid
      AND t.deleted_at IS NULL
      AND t.transaction_type IN ('GOAL_CONTRIBUTION', 'TRANSFER')
  `;

  const row = rows[0];
  if (row && row.missing_rate_count > 0n) {
    throw new GoalProgressUnavailableError(
      scope.goalId,
      row.missing_rate_currency ?? '(unknown)',
      scope.currency,
    );
  }

  const contributedAmount = formatDecimalAmount(row?.contributed ?? '0');
  const progressPercent = percentOf(contributedAmount, scope.targetAmount);

  return { contributedAmount, progressPercent };
}

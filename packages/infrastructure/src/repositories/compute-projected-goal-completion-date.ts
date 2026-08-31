import type { Prisma, PrismaClient } from '@prisma/client';
import {
  compareDecimalAmounts,
  GoalProgressUnavailableError,
  subtractDecimalAmounts,
} from '@afa/domain';

import { computeSavingsGoalProgress } from './compute-savings-goal-progress';

/** Same shape `computeAccountBalance`/`computeSavingsGoalProgress` already rely on. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

const TRAILING_WINDOW_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProjectedGoalCompletionDateScope {
  goalId: string;
  currency: string;
  targetAmount: string;
  /** `savings_goals.created_at` — the actual anchor for edge case B (goal younger than the trailing window). */
  createdAt: Date;
  /** Caller-supplied reference "today" (user-local, per `resolveUserLocalReferenceDate`'s own established convention) — this function never calls `new Date()` internally, matching every other §8.14 formula's `asOfDate`-style contract. */
  today: Date;
}

/**
 * TASK-FIN-008 (§8.14.5's second formula) — `projected_completion_date(goal)
 * = today + (target_amount − current_progress) / average_daily_contribution_rate(trailing 30 days)`.
 * The ONE shared implementation (FR-FIN-031). A dedicated calculation
 * module, not embedded in Telegram/report code, matching every other §8.14
 * formula's own placement.
 *
 * `current_progress` is `computeSavingsGoalProgress`'s own
 * `contributedAmount` — reused, never reimplemented (FR-FIN-031); its own
 * FR-FIN-043 fail-loud contract (`GoalProgressUnavailableError`) propagates
 * unchanged.
 *
 * Three edge cases, resolved per explicit product decision (§8.14.5's own
 * text leaves all three genuinely undefined):
 *
 * A. Zero (or undefined — see the windowDays<=0 case folded in here) trailing
 *    contribution rate returns `null`, never a fabricated future date — an
 *    infinite/undefined projection is not expressible as a `Date`.
 * B. A goal younger than the 30-day trailing window uses its ACTUAL elapsed
 *    age (`today - createdAt`) as the averaging window's day-count
 *    denominator — never zero-padded, never divided by a flat `30`
 *    regardless of the goal's real age.
 * C. `current_progress >= target_amount` returns `today` directly — no
 *    division, no future-date math, matching FR-FIN-014's "further
 *    contributions remain possible past 100%" precedent (a completed goal
 *    has no further "days remaining" to project).
 *
 * `average_daily_contribution_rate` and the final days-remaining division
 * are deliberately plain `Number()` arithmetic, not BigInt-scaled decimal
 * arithmetic — the result feeds a `Date` (a day-count), never a value
 * written back to a monetary column, the same "comparison/derived figure,
 * not stored money" exemption `percentOf` (`decimal-amount.ts`) already
 * established for DB-P3/FR-DB-027's float ban. `remaining` itself (target
 * minus current progress, still money-scale) IS computed via
 * `subtractDecimalAmounts` first, precision-safe, before that one Number
 * conversion.
 */
export async function computeProjectedGoalCompletionDate(
  client: QueryableClient,
  scope: ProjectedGoalCompletionDateScope,
): Promise<Date | null> {
  const progress = await computeSavingsGoalProgress(client, {
    goalId: scope.goalId,
    currency: scope.currency,
    targetAmount: scope.targetAmount,
  });

  // Edge case C — already at or past target: today, no future projection.
  if (compareDecimalAmounts(progress.contributedAmount, scope.targetAmount) >= 0) {
    return scope.today;
  }

  // Edge case B — the trailing window never extends before the goal's own
  // creation date; a goal younger than 30 days uses its actual elapsed age.
  const thirtyDaysAgo = new Date(
    scope.today.getTime() - TRAILING_WINDOW_DAYS * MILLISECONDS_PER_DAY,
  );
  const windowStart = scope.createdAt > thirtyDaysAgo ? scope.createdAt : thirtyDaysAgo;
  const windowDays = Math.round(
    (scope.today.getTime() - windowStart.getTime()) / MILLISECONDS_PER_DAY,
  );

  // A goal created today (or a window that cannot elapse even one day) has
  // no meaningful daily rate to compute — folds into edge case A's "never
  // fabricate a date" outcome rather than dividing by zero.
  if (windowDays <= 0) {
    return null;
  }

  const windowedContributed = await computeWindowedContribution(client, scope, windowStart);
  const dailyRate = Number(windowedContributed) / windowDays;

  // Edge case A — zero (or, defensively, negative/non-finite) trailing rate.
  if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
    return null;
  }

  const remaining = subtractDecimalAmounts(scope.targetAmount, progress.contributedAmount);
  const daysNeeded = Math.ceil(Number(remaining) / dailyRate);

  return new Date(scope.today.getTime() + daysNeeded * MILLISECONDS_PER_DAY);
}

/**
 * The exact same `GOAL_CONTRIBUTION` + linked-`TRANSFER` WHERE/JOIN shape
 * `computeSavingsGoalProgress` uses, bounded additionally by
 * `transaction_date >= windowStart` — a genuinely different query (windowed
 * vs. all-time), not a duplicate of that function's own unbounded one.
 */
async function computeWindowedContribution(
  client: QueryableClient,
  scope: ProjectedGoalCompletionDateScope,
  windowStart: Date,
): Promise<string> {
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
      AND t.transaction_date >= ${windowStart}
      AND t.transaction_date <= ${scope.today}
  `;

  const row = rows[0];
  if (row && row.missing_rate_count > 0n) {
    throw new GoalProgressUnavailableError(
      scope.goalId,
      row.missing_rate_currency ?? '(unknown)',
      scope.currency,
    );
  }

  return row?.contributed ?? '0';
}

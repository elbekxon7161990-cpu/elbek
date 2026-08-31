import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  CashFlowUnavailableError,
  roundDecimalAmountToScale,
  subtractDecimalAmounts,
} from '@afa/domain';

/** Same shape `computeAccountBalance`/`computeBudgetUsedAmount`/`computeSavingsGoalProgress` already rely on. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export interface NetCashFlowScope {
  userId: string;
  /** The user's own `defaultCurrency` — every transaction in the period is converted to this currency before summing (BR-FIN-006). */
  defaultCurrency: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * TASK-FIN-008 (§8.14.3) — `net_cash_flow(period) = Σ(INCOME + SALARY +
 * REFUND, transaction_date within period) − Σ(EXPENSE, transaction_date
 * within period)`. The ONE shared implementation (FR-FIN-031).
 *
 * Currency handling (approved decision — §8.14.3's own formula text states
 * no conversion rule, unlike its sibling formulas; BR-FIN-006's own general
 * wording — "any aggregation in §8.14 spanning more than one transaction
 * currency" — is applied here identically to how `computeAccountBalance`/
 * `computeSavingsGoalProgress` already apply it): every transaction is
 * converted to `scope.defaultCurrency` via a `LATERAL` join against
 * `fx_rates`, using that transaction's OWN date, the exact same
 * "most-recent-rate-on-or-before-date" fallback and fail-loud
 * (`CashFlowUnavailableError`, FR-FIN-043) contract as `computeAccountBalance`
 * — re-using the identical SQL shape rather than inventing a third FX
 * lookup variant.
 *
 * `full_cash_flow` (§8.14.3's second formula) is implemented separately in
 * `compute-full-cash-flow.ts`, which calls `computeNetCashFlowRawParts`
 * below rather than duplicating this query.
 */
export async function computeNetCashFlow(
  client: QueryableClient,
  scope: NetCashFlowScope,
): Promise<string> {
  const { rawTotalIncome, rawTotalExpense } = await computeNetCashFlowRawParts(client, scope);
  return roundDecimalAmountToScale(subtractDecimalAmounts(rawTotalIncome, rawTotalExpense), 2);
}

/**
 * TASK-FIN-008 (`computeFullCashFlow`'s own precision-safe split) — the SAME
 * query `computeNetCashFlow` runs, minus the final subtract-and-round step,
 * returning both raw (possibly wider-than-2-decimal) SQL sums separately.
 * Exists ONLY so `computeFullCashFlow` can combine these raw income/expense
 * sums with its own raw debt/transfer terms and round exactly ONCE on the
 * final combined total — the same "round once, at the very end" lesson this
 * task's own `computeAccountBalance`/`computeAccountBalanceRaw` split
 * already established. Zero SQL duplication: `computeNetCashFlow` is now a
 * two-line wrapper around this function; its own public contract (and every
 * existing caller) is completely unchanged.
 */
export async function computeNetCashFlowRawParts(
  client: QueryableClient,
  scope: NetCashFlowScope,
): Promise<{ rawTotalIncome: string; rawTotalExpense: string }> {
  const incomeLikeTypes = Prisma.sql`t.transaction_type IN ('INCOME', 'SALARY', 'REFUND')`;

  const rows = await client.$queryRaw<
    Array<{
      total_income: string;
      total_expense: string;
      missing_rate_count: bigint;
      missing_rate_currency: string | null;
    }>
  >`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN ${incomeLikeTypes} AND t.currency = ${scope.defaultCurrency} THEN t.amount
          WHEN ${incomeLikeTypes} THEN t.amount * fx.rate
          ELSE 0
        END
      ), 0)::text AS total_income,
      COALESCE(SUM(
        CASE
          WHEN t.transaction_type = 'EXPENSE' AND t.currency = ${scope.defaultCurrency} THEN t.amount
          WHEN t.transaction_type = 'EXPENSE' THEN t.amount * fx.rate
          ELSE 0
        END
      ), 0)::text AS total_expense,
      COUNT(*) FILTER (WHERE t.currency != ${scope.defaultCurrency} AND fx.rate IS NULL) AS missing_rate_count,
      MIN(t.currency) FILTER (WHERE t.currency != ${scope.defaultCurrency} AND fx.rate IS NULL) AS missing_rate_currency
    FROM transactions t
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = t.currency
        AND fxr.quote_currency = ${scope.defaultCurrency}
        AND fxr.as_of_date <= t.transaction_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) fx ON t.currency != ${scope.defaultCurrency}
    WHERE t.user_id = ${scope.userId}::uuid
      AND t.deleted_at IS NULL
      AND t.transaction_date BETWEEN ${scope.periodStart} AND ${scope.periodEnd}
      AND (${incomeLikeTypes} OR t.transaction_type = 'EXPENSE')
  `;

  const row = rows[0];
  if (row && row.missing_rate_count > 0n) {
    throw new CashFlowUnavailableError(
      scope.userId,
      row.missing_rate_currency ?? '(unknown)',
      scope.defaultCurrency,
    );
  }

  // RAW return — no rounding here. Concrete case this exists to fix (in the
  // `computeNetCashFlow` wrapper above): raw income `1.004`, raw expense
  // `0.996` — rounding each independently before subtracting would give
  // `round(1.004) - round(0.996)` = `1.00 - 1.00` = `0.00`; the correct
  // HALF-UP-once-at-the-end result is `round(1.004 - 0.996)` = `0.01`.
  return {
    rawTotalIncome: row?.total_income ?? '0',
    rawTotalExpense: row?.total_expense ?? '0',
  };
}

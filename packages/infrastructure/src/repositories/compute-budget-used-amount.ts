import type { Prisma, PrismaClient } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/** Either the top-level extended client or an in-flight `$transaction` callback's `tx` — both expose the same `$queryRaw` shape this function needs, so it works identically whether called standalone (`/budget` view) or from inside `PrismaTransactionRepository.create()`'s own transaction (the synchronous threshold-check hook). */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export interface BudgetScopeForUtilization {
  userId: string;
  scopeType: 'category' | 'overall';
  /** Non-null exactly when `scopeType === 'category'`. */
  categoryId: string | null;
  /** The budget's own category row's `parent_category_id` — `null` if `categoryId` is itself a top-level category, non-null if `categoryId` is itself a subcategory. Ignored when `scopeType === 'overall'`. See `matchesBudgetCategoryScope`'s own doc comment (`@afa/domain`) for the full BR-BUD-002 reasoning this mirrors in SQL. */
  categoryParentId: string | null;
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * §8.14.4's `budget_utilization` formula — "Σ(EXPENSE.amount converted to
 * budget.currency per BR-FIN-006, category matches budget scope per
 * BR-FIN-004, transaction_date within period)" — the ONE shared SQL
 * aggregation both `PrismaBudgetRepository`'s own utilization methods and
 * `evaluateBudgetThresholdsOnExpenseCommit` (the synchronous
 * `PrismaTransactionRepository.create()` hook) call, per FR-FIN-031's "no
 * consumer may reimplement the formula independently."
 *
 * Cross-currency conversion (BR-BUD-003): a transaction in a currency other
 * than the budget's own is converted via the `fx_rates` row for
 * `(transaction.currency -> budget.currency, transaction.transaction_date)`
 * — the exact-date snapshot BR-BUD-003 requires, never "today's rate"
 * applied retroactively. If no such rate is seeded, that transaction
 * contributes `0` to the aggregate rather than throwing — a disclosed
 * limitation, not a crash: this environment (and, as far as this task's own
 * inspection found, every environment in this codebase) has zero `fx_rates`
 * seed data, since no prior task ever built FX-rate ingestion (that
 * infrastructure belongs to TASK-FIN-007, explicitly out of this task's
 * scope) — see this task's final report.
 *
 * `excludeTransactionId` lets the same-transaction "before" figure be
 * computed by excluding the just-inserted row, rather than a second,
 * separately-reasoned subtraction — avoiding any risk of the "before" and
 * "after" figures drifting out of sync with each other's own category-match/
 * currency-conversion logic.
 */
export async function computeBudgetUsedAmount(
  client: QueryableClient,
  scope: BudgetScopeForUtilization,
  excludeTransactionId: string | null,
): Promise<string> {
  const rows =
    scope.scopeType === 'overall'
      ? await client.$queryRaw<Array<{ used_amount: string }>>`
          SELECT COALESCE(SUM(
            CASE WHEN t.currency = ${scope.currency} THEN t.amount
                 ELSE t.amount * COALESCE(fx.rate, 0)
            END
          ), 0)::text as used_amount
          FROM transactions t
          LEFT JOIN fx_rates fx
            ON fx.base_currency = t.currency
           AND fx.quote_currency = ${scope.currency}
           AND fx.as_of_date = t.transaction_date
          WHERE t.user_id = ${scope.userId}::uuid
            AND t.transaction_type = 'EXPENSE'
            AND t.deleted_at IS NULL
            AND t.transaction_date BETWEEN ${scope.currentPeriodStart} AND ${scope.currentPeriodEnd}
            AND (${excludeTransactionId}::uuid IS NULL OR t.id != ${excludeTransactionId}::uuid)
        `
      : await client.$queryRaw<Array<{ used_amount: string }>>`
          SELECT COALESCE(SUM(
            CASE WHEN t.currency = ${scope.currency} THEN t.amount
                 ELSE t.amount * COALESCE(fx.rate, 0)
            END
          ), 0)::text as used_amount
          FROM transactions t
          LEFT JOIN fx_rates fx
            ON fx.base_currency = t.currency
           AND fx.quote_currency = ${scope.currency}
           AND fx.as_of_date = t.transaction_date
          WHERE t.user_id = ${scope.userId}::uuid
            AND t.transaction_type = 'EXPENSE'
            AND t.deleted_at IS NULL
            AND t.transaction_date BETWEEN ${scope.currentPeriodStart} AND ${scope.currentPeriodEnd}
            AND (${excludeTransactionId}::uuid IS NULL OR t.id != ${excludeTransactionId}::uuid)
            AND (
              (${scope.categoryParentId}::uuid IS NULL AND t.category_id = ${scope.categoryId}::uuid)
              OR
              (${scope.categoryParentId}::uuid IS NOT NULL AND t.subcategory_id = ${scope.categoryId}::uuid)
            )
        `;

  return formatDecimalAmount(rows[0]?.used_amount ?? '0');
}

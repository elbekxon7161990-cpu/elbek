import type { TransactionType } from '../entities/transaction.entity';

/**
 * TASK-REP-007 (Chapter 9 §9.1.4/§9.5) — shared shapes every one of the 8
 * in-scope report types is built from. Deliberately few, general primitives
 * (not one bespoke shape per report type) — §9.5.5's own text: "Share one
 * parameterized SQL template differing only in date-range boundaries and
 * comparison-period offset... reuses, rather than forks, the fixed-period
 * query logic."
 */

/** `start` inclusive, `end` exclusive — matches the existing `[gte, lt)` convention already used by `PrismaExpenseHistoryRepository.getTrailingAverageExpenseAmount`. */
export interface ReportDateRange {
  readonly start: Date;
  readonly end: Date;
}

export interface ReportQueryFilters {
  readonly categoryId?: string;
  readonly merchant?: string;
  /** Defaults to EXPENSE-only at the call site where that matters (category/merchant breakdowns) — the repository itself applies no default, it only filters when given one. */
  readonly transactionType?: TransactionType;
  /** TASK-FIN-012 (§10.3, FR-SCH-001) — inclusive lower/upper bound on `amount`, canonical decimal strings compared at the database layer (never a JS-float comparison, DB-P3/FR-DB-027). Only `searchTransactions` (below) consumes these two; every other consumer of this shared filter type leaves them `undefined`. */
  readonly minAmount?: string;
  readonly maxAmount?: string;
  /** TASK-FIN-012 (§10.3, FR-SCH-001) — matches a transaction whose `tags` array contains ANY of the given values (`hasSome`), against the existing `idx_transactions_tags_gin` index — no new index required. */
  readonly tags?: readonly string[];
}

/**
 * `totalExpense`/`totalIncome` split mirrors Chapter 8 §8.14.3's own
 * `net_cash_flow` formula grouping exactly: `Σ(INCOME + SALARY + REFUND) −
 * Σ(EXPENSE)` — "income" here means INCOME+SALARY+REFUND combined, not a
 * separately-invented category, since this task reuses that PRD-defined
 * grouping rather than inventing its own.
 */
export interface ReportPeriodTotals {
  readonly totalExpense: string;
  readonly totalIncome: string;
}

export interface CategoryAmount {
  readonly categoryId: string;
  readonly totalAmount: string;
}

export interface MerchantAmount {
  readonly merchant: string;
  readonly totalAmount: string;
  readonly transactionCount: number;
}

export type ReportBucketGranularity = 'day' | 'month';

export interface ReportPeriodBucket {
  readonly bucketStart: Date;
  readonly totalExpense: string;
  readonly totalIncome: string;
}

/**
 * TASK-REP-001 (remaining scope, §9.1.4 Cash Flow Report). `netCashFlow` is
 * always present (the standard/default view, FR-CSF-001) — `fullCashFlow`
 * is `null` unless the caller opted in (FR-CSF-002's "optional" full view),
 * never silently populated.
 */
export interface CashFlowTotals {
  readonly netCashFlow: string;
  readonly fullCashFlow: string | null;
}

export interface ReportTransactionSummary {
  readonly id: string;
  readonly amount: string;
  readonly transactionType: TransactionType;
  readonly categoryId: string;
  readonly merchant: string | null;
  readonly transactionDate: Date;
  readonly description: string;
}

/**
 * TASK-FIN-012 (§10.3) — `ReportTransactionSummary` plus `currency`. A
 * search result can span accounts of different currencies (unlike
 * `getLargestTransactions`'s own report-scoped callers, which have never
 * needed to display currency alongside the figure) — a NEW, dedicated type
 * rather than adding `currency` to `ReportTransactionSummary` itself, so
 * TASK-REP-001's own existing shape/callers/tests are untouched.
 */
export interface SearchResultSummary extends ReportTransactionSummary {
  readonly currency: string;
}

/**
 * TASK-FIN-012 (§10.3, FR-SCH-003/004) — `searchTransactions`'s own result
 * shape. `totalCount` is the total number of matching rows across every
 * page (not just this page's length) — the caller needs it to decide
 * whether a "next page" control should be offered, per FR-SCH-003's
 * pagination requirement, without a separate round trip.
 */
export interface SearchTransactionsResult {
  readonly results: readonly SearchResultSummary[];
  readonly totalCount: number;
}

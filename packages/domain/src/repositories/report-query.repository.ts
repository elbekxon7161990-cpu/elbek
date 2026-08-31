import type {
  CashFlowTotals,
  CategoryAmount,
  MerchantAmount,
  ReportBucketGranularity,
  ReportDateRange,
  ReportPeriodBucket,
  ReportPeriodTotals,
  ReportQueryFilters,
  ReportTransactionSummary,
  SearchTransactionsResult,
} from '../reports/report-query-types';

export const REPORT_QUERY_REPOSITORY = Symbol('REPORT_QUERY_REPOSITORY');

/**
 * TASK-REP-007 (Chapter 9 §9.1.4/§9.5) — the read-side counterpart to
 * `TransactionRepository`, following the same precedent
 * `ExpenseHistoryRepository` (TASK-FIN-001 Part 2) already established: a
 * dedicated, purpose-scoped repository over the SAME `transactions` table,
 * rather than adding analytics methods to `TransactionRepository`'s own
 * CRUD-lifecycle interface. Every method here is a deterministic SQL
 * aggregation, never LLM-computed (Chapter 4 §4.7.1, §9.1.6).
 *
 * Deliberately a small set of general, reusable primitives — not one method
 * per report type — since §9.5.5 explicitly states the 8 in-scope report
 * types "share one parameterized SQL template," composed at the application
 * layer (`GenerateReportUseCase`) rather than forked per report type here.
 */
export interface ReportQueryRepository {
  /** "Total spent/earned" (§9.1.4 rows 1–5, 8) — `totalExpense`/`totalIncome` per `ReportPeriodTotals`'s own doc comment. */
  getTotals(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<ReportPeriodTotals>;

  /** "Category breakdown" (§9.1.4 rows 1–5, 8), sorted descending by amount. */
  getCategoryBreakdown(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<CategoryAmount[]>;

  /** "Merchant breakdown"/"top merchants" (§9.1.4 rows 3 [structure reused by row 8], 6), sorted descending by amount. */
  getMerchantBreakdown(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<MerchantAmount[]>;

  /** "Day-by-day trend" (Weekly, row 2) / "month-by-month trend" (Quarterly/Yearly, rows 4–5) / "trend over time" (Category/Merchant, rows 6–7) — one bucketed query for all of them, differing only in granularity. */
  getPeriodicBreakdown(
    userId: string,
    range: ReportDateRange,
    granularity: ReportBucketGranularity,
    filters?: ReportQueryFilters,
  ): Promise<ReportPeriodBucket[]>;

  /** "Largest transactions" (Category Report, row 6). `filters` is required (not optional) here — this method is never called unscoped. */
  getLargestTransactions(
    userId: string,
    range: ReportDateRange,
    filters: ReportQueryFilters,
    limit: number,
  ): Promise<ReportTransactionSummary[]>;

  /** "Frequency" (Merchant Report, row 7). */
  getTransactionCount(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<number>;

  /**
   * FR-REP-023's historical-availability lower bound, and the general "a
   * prior period exists" check §9.5.7 requires (comparison line "omitted
   * for a user's very first period... never shown as N/A"). `null` when the
   * user has no transactions at all.
   */
  getEarliestTransactionDate(userId: string): Promise<Date | null>;

  /**
   * TASK-REP-001 (remaining scope, §9.1.4 Cash Flow Report, §8.14.3). Never
   * a reimplementation of `net_cash_flow`/`full_cash_flow` — the
   * implementation of this port method delegates directly to TASK-FIN-008's
   * own `computeNetCashFlow`/`computeFullCashFlow` (FR-FIN-031, one shared
   * formula). This port method exists only because `packages/application`
   * may never import `packages/infrastructure` directly (this package's own
   * `package.json` description) — `ReportQueryRepository` is the existing
   * domain port `GenerateReportUseCase` already depends on, so the formula
   * call is exposed through it rather than inventing a second, narrower
   * port for one method.
   *
   * `includeFullCashFlow: false` (the default, per FR-CSF-002's explicit
   * "optional" framing and BR-REP-003 — never silently defaulted to the
   * broader view) computes ONLY `netCashFlow` (`fullCashFlow: null` in the
   * result); `true` additionally computes `fullCashFlow` via
   * `computeFullCashFlow` (skipping its extra debt/transfer queries
   * entirely when not requested).
   */
  getCashFlow(
    userId: string,
    range: ReportDateRange,
    defaultCurrency: string,
    includeFullCashFlow: boolean,
  ): Promise<CashFlowTotals>;

  /**
   * TASK-FIN-012 (Chapter 10 §10.3, FR-SCH-001/003/004/006) — `/search`'s own
   * dedicated query, deliberately NOT a reuse of `getLargestTransactions`
   * (that method is TASK-REP-001's own "largest transactions" feature for
   * the Category Report, hard-ordered by `amount DESC`; search results are
   * ordered most-recent-first per FR-SCH-003's own "showing enough detail to
   * identify the transaction" framing, the natural order for a personal
   * ledger lookup — reusing `getLargestTransactions` would either silently
   * change its existing, tested ordering for TASK-REP-001's own consumer, or
   * require a new parameter threading through every one of its existing
   * call sites for a distinction only this task needs).
   *
   * `range` is optional — unlike every other method on this port, a search
   * may legitimately have no date bound at all (FR-SCH-001 lists date range
   * as one of several independent, optional filters, not a required one).
   * `range: null` means unbounded (no `transactionDate` predicate at all).
   *
   * Ordered `transaction_date DESC, id DESC` — the `id` tie-break makes
   * pagination deterministic even when two transactions share an identical
   * `transaction_date` (FR-SCH-003's own "no duplicate/missing rows across
   * pages" requirement), reusing the existing `idx_transactions_user_date`
   * index (FR-SCH-006 — no new index).
   */
  searchTransactions(
    userId: string,
    filters: ReportQueryFilters,
    range: ReportDateRange | null,
    pagination: { readonly limit: number; readonly offset: number },
  ): Promise<SearchTransactionsResult>;
}

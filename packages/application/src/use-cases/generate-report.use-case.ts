import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BUDGET_REPOSITORY,
  computeDailyBoundary,
  computeDebtOverdueDays,
  computeMonthlyBoundary,
  computeQuarterlyBoundary,
  computeWeeklyBoundary,
  computeYearlyBoundary,
  DEBT_REPOSITORY,
  REPORT_CACHE_REPOSITORY,
  REPORT_QUERY_REPOSITORY,
  subtractDecimalAmounts,
  type BudgetRepository,
  type BudgetScopeType,
  type CategoryAmount,
  type DebtDirection,
  type DebtRepository,
  type MerchantAmount,
  type ReportCacheRepository,
  type ReportDateRange,
  type ReportPeriodBucket,
  type ReportPeriodTotals,
  type ReportPeriodType,
  type ReportQueryRepository,
  type ReportTransactionSummary,
} from '@afa/domain';

/**
 * TASK-REP-007 — TTLs per Chapter 13 §13.38.2: "≤60s for in-progress
 * periods, long-lived for closed periods." §13.38.2 does not give an exact
 * number for "long-lived" — 30 days is a judgment call (not PRD-mandated),
 * the same kind of documented default this engagement has used elsewhere
 * (e.g. FR-DB-015's `DOMAIN_EVENT_BATCH_SIZE`).
 */
const IN_PROGRESS_PERIOD_TTL_SECONDS = 60;
const CLOSED_PERIOD_TTL_SECONDS = 30 * 24 * 60 * 60;

/** ExpenseHistoryRepository's own trailing-average precedent uses 90 days for a *transaction-level* average; Daily's "comparison to daily average" is a *day-level* average instead, so it is not the same query — 30 days is a separate, documented judgment call for this different metric. */
const DAILY_AVERAGE_WINDOW_DAYS = 30;

export interface DailyReport {
  readonly reportType: 'daily';
  readonly periodKey: string;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly categoryBreakdown: CategoryAmount[];
  /** `null` when there is no trailing history to average against — never a misleading "0" comparison (mirrors FR-EXP-004's own "absent baseline must never produce a false result" principle). */
  readonly comparisonToDailyAverage: { averageDailyExpense: string } | null;
}

export interface WeeklyReport {
  readonly reportType: 'weekly';
  readonly periodKey: string;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly categoryBreakdown: CategoryAmount[];
  readonly dayByDayTrend: ReportPeriodBucket[];
  /** `null` for a user's very first week — §9.5.7: "omitted... never shown as N/A." */
  readonly priorWeekComparison: ReportPeriodTotals | null;
}

export interface QuarterlyReport {
  readonly reportType: 'quarterly';
  readonly periodKey: string;
  readonly monthlyTrend: ReportPeriodBucket[];
  readonly categoryShift: { readonly current: CategoryAmount[]; readonly prior: CategoryAmount[] };
}

export interface YearlyReport {
  readonly reportType: 'yearly';
  readonly periodKey: string;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly monthByMonthTrend: ReportPeriodBucket[];
  readonly categoryBreakdown: CategoryAmount[];
  /** `null` unless FR-REP-023's historical-availability rule is satisfied for the prior year. */
  readonly yearOverYearComparison: ReportPeriodTotals | null;
}

export interface CategoryReport {
  readonly reportType: 'category';
  readonly categoryId: string;
  readonly range: ReportDateRange;
  readonly trend: ReportPeriodBucket[];
  readonly merchantBreakdown: MerchantAmount[];
  readonly largestTransactions: ReportTransactionSummary[];
}

export interface MerchantReport {
  readonly reportType: 'merchant';
  readonly merchant: string;
  readonly range: ReportDateRange;
  readonly totalAmount: string;
  readonly transactionCount: number;
  readonly trend: ReportPeriodBucket[];
}

export interface CustomRangeReport {
  readonly reportType: 'custom_range';
  readonly range: ReportDateRange;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly categoryBreakdown: CategoryAmount[];
  readonly merchantBreakdown: MerchantAmount[];
}

export interface MonthlyReport {
  readonly reportType: 'monthly';
  readonly periodKey: string;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly totalSaved: string;
  readonly categoryBreakdown: CategoryAmount[];
  readonly topMerchants: MerchantAmount[];
  readonly budgetPerformance: BudgetPerformanceEntry[];
  /** `null` for a user's very first month — same convention as `WeeklyReport.priorWeekComparison`. */
  readonly priorMonthComparison: ReportPeriodTotals | null;
}

export interface BudgetPerformanceEntry {
  readonly budgetId: string;
  readonly scopeType: BudgetScopeType;
  readonly categoryId: string | null;
  readonly limitAmount: string;
  readonly usedAmount: string;
  readonly utilizationPercent: number;
}

export interface CashFlowReport {
  readonly reportType: 'cash_flow';
  readonly range: ReportDateRange;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly periodicTrend: ReportPeriodBucket[];
  readonly netCashFlow: string;
  /** `null` unless `options.fullCashFlow` was explicitly `true` (FR-CSF-002 — never silently defaulted to the broader view). */
  readonly fullCashFlow: string | null;
}

export interface OpenDebtSummaryEntry {
  readonly debtId: string;
  readonly direction: DebtDirection;
  readonly counterpartyName: string;
  readonly originalAmount: string;
  readonly outstandingBalance: string;
  readonly currency: string;
  readonly dueDate: Date | null;
  /** `null` when not overdue (no due date, or the due date has not yet passed) — never negative. */
  readonly overdueDays: number | null;
}

export interface SettledDebtSummaryEntry {
  readonly debtId: string;
  readonly direction: DebtDirection;
  readonly counterpartyName: string;
  readonly originalAmount: string;
  readonly currency: string;
  readonly status: 'repaid' | 'forgiven';
  readonly settledAt: Date;
}

export interface DebtSummaryReport {
  readonly reportType: 'debt_summary';
  readonly openDebtsGiven: OpenDebtSummaryEntry[];
  readonly openDebtsReceived: OpenDebtSummaryEntry[];
  readonly settledDebts: SettledDebtSummaryEntry[];
}

export type CategoryTrajectoryDirection = 'increasing' | 'decreasing' | 'flat';

export interface CategoryTrajectory {
  readonly categoryId: string;
  readonly direction: CategoryTrajectoryDirection;
  readonly firstHalfTotal: string;
  readonly secondHalfTotal: string;
}

export interface TrendAnalysisReport {
  readonly reportType: 'trend_analysis';
  readonly range: ReportDateRange;
  readonly monthlyTrend: ReportPeriodBucket[];
  readonly categoryTrajectory: CategoryTrajectory[];
}

/**
 * TASK-REP-007 / TASK-REP-001 (remaining scope) (Chapter 9 §9.1.4/§9.5) —
 * all 11 report types in §9.1.4's inventory. Monthly, Cash Flow, and Debt
 * Summary were originally deliberately absent (blocked by
 * TASK-FIN-003/002/004/008); `generateMonthly`/`generateCashFlow`/
 * `generateDebtSummary` below close that gap now that all four are done.
 *
 * **Caching decision, explicitly recorded**: Daily/Weekly/Monthly/Quarterly/
 * Yearly are cached — the 5 report types TASK-DB-009's own
 * `ReportPeriodType`/invalidation consumer covers (`daily`/`weekly`/
 * `monthly`/`quarterly`/`yearly`). Category/Merchant/Custom Range/Trend
 * Analysis/Cash Flow/Debt Summary are always computed live — caching them
 * would need cache-key dimensions (`categoryId`/`merchant`/an arbitrary
 * range/a `fullCashFlow` toggle/no period concept at all for Debt Summary's
 * point-in-time snapshot) the existing `report:{user_id}:{report_type}:
 * {period_key}` schema cannot express, and TASK-DB-009's own invalidation
 * consumer has no rule for such a key — caching without a matching
 * invalidation path would silently violate FR-REP-002's "never a stale
 * pre-computed cache" guarantee. This mirrors the identical, already-
 * approved treatment of Custom Range ("NEVER cached") extended to the newly
 * added live report types, not a new decision invented for this task.
 *
 * Each of the 5 cached report types is stored as ONE JSON blob per
 * `(report_type, period_key)` — matching §9.5.2's sequence diagram literally
 * ("GET... cached aggregate" / "SET", singular), not fragmented into
 * separately-cached pieces. The prior-period comparison figure embedded in
 * each report is computed via the same cache-then-SQL helper, keyed under
 * the PRIOR period's own `(report_type, period_key)` — reusing whatever is
 * already cached for that (now-closed) period rather than always
 * recomputing it, consistent with §9.5.4's worked example ("compared
 * against June's already-cached totals").
 */
@Injectable()
export class GenerateReportUseCase {
  /**
   * `debtRepository`/`budgetRepository` are `@Optional()` — only
   * `generateDebtSummary`/`generateMonthly` need them (Debt/Budget live in
   * their own tables, wholly independent of `ReportQueryRepository`'s own
   * `transactions`-table scope, mirroring BR-DBT-003's "must stay wholly
   * independent" principle). Optional rather than required keeps every
   * existing 2-argument construction site (the 18 in this class's own unit
   * spec, none of which exercise the 2 new methods) unchanged — a minimal,
   * additive constructor change, not a breaking one. Real composition roots
   * always provide both; `generateDebtSummary`/`generateMonthly` throw a
   * clear internal error if called without them, rather than silently
   * degrading.
   */
  constructor(
    @Inject(REPORT_QUERY_REPOSITORY) private readonly reportQueryRepository: ReportQueryRepository,
    @Inject(REPORT_CACHE_REPOSITORY) private readonly reportCacheRepository: ReportCacheRepository,
    @Inject(DEBT_REPOSITORY) @Optional() private readonly debtRepository?: DebtRepository,
    @Inject(BUDGET_REPOSITORY) @Optional() private readonly budgetRepository?: BudgetRepository,
  ) {}

  async generateDaily(userId: string, asOf: Date = new Date()): Promise<DailyReport> {
    const boundary = computeDailyBoundary(asOf);
    const [totals, categoryBreakdown, averageWindowTotals] = await Promise.all([
      this.getCachedOrComputedTotals(
        userId,
        'daily',
        boundary.periodKey,
        boundary.current,
        IN_PROGRESS_PERIOD_TTL_SECONDS,
      ),
      this.reportQueryRepository.getCategoryBreakdown(userId, boundary.current, {
        transactionType: 'EXPENSE',
      }),
      this.getDailyAverageWindowExpense(userId, asOf),
    ]);

    return {
      reportType: 'daily',
      periodKey: boundary.periodKey,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      categoryBreakdown,
      comparisonToDailyAverage: averageWindowTotals,
    };
  }

  async generateWeekly(userId: string, asOf: Date = new Date()): Promise<WeeklyReport> {
    const boundary = computeWeeklyBoundary(asOf);
    const earliestTransactionDate =
      await this.reportQueryRepository.getEarliestTransactionDate(userId);
    const hasPriorPeriod =
      earliestTransactionDate !== null && earliestTransactionDate < boundary.current.start;

    const [totals, categoryBreakdown, dayByDayTrend, priorTotals] = await Promise.all([
      this.getCachedOrComputedTotals(
        userId,
        'weekly',
        boundary.periodKey,
        boundary.current,
        IN_PROGRESS_PERIOD_TTL_SECONDS,
      ),
      this.reportQueryRepository.getCategoryBreakdown(userId, boundary.current, {
        transactionType: 'EXPENSE',
      }),
      this.reportQueryRepository.getPeriodicBreakdown(userId, boundary.current, 'day'),
      hasPriorPeriod
        ? this.getCachedOrComputedTotals(
            userId,
            'weekly',
            boundary.priorPeriodKey,
            boundary.prior,
            CLOSED_PERIOD_TTL_SECONDS,
          )
        : Promise.resolve(null),
    ]);

    return {
      reportType: 'weekly',
      periodKey: boundary.periodKey,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      categoryBreakdown,
      dayByDayTrend,
      priorWeekComparison: priorTotals,
    };
  }

  async generateQuarterly(userId: string, asOf: Date = new Date()): Promise<QuarterlyReport> {
    const boundary = computeQuarterlyBoundary(asOf);
    const [monthlyTrend, currentCategoryBreakdown, priorCategoryBreakdown] = await Promise.all([
      this.reportQueryRepository.getPeriodicBreakdown(userId, boundary.current, 'month'),
      this.reportQueryRepository.getCategoryBreakdown(userId, boundary.current, {
        transactionType: 'EXPENSE',
      }),
      this.reportQueryRepository.getCategoryBreakdown(userId, boundary.prior, {
        transactionType: 'EXPENSE',
      }),
    ]);

    return {
      reportType: 'quarterly',
      periodKey: boundary.periodKey,
      monthlyTrend,
      categoryShift: { current: currentCategoryBreakdown, prior: priorCategoryBreakdown },
    };
  }

  async generateYearly(userId: string, asOf: Date = new Date()): Promise<YearlyReport> {
    const boundary = computeYearlyBoundary(asOf);
    const earliestTransactionDate =
      await this.reportQueryRepository.getEarliestTransactionDate(userId);
    // FR-REP-023 — a comparison is only meaningful once real data existed for the prior period too.
    const hasPriorYearData =
      earliestTransactionDate !== null && earliestTransactionDate < boundary.prior.end;

    const [totals, monthByMonthTrend, categoryBreakdown, priorTotals] = await Promise.all([
      this.getCachedOrComputedTotals(
        userId,
        'yearly',
        boundary.periodKey,
        boundary.current,
        IN_PROGRESS_PERIOD_TTL_SECONDS,
      ),
      this.reportQueryRepository.getPeriodicBreakdown(userId, boundary.current, 'month'),
      this.reportQueryRepository.getCategoryBreakdown(userId, boundary.current, {
        transactionType: 'EXPENSE',
      }),
      hasPriorYearData
        ? this.getCachedOrComputedTotals(
            userId,
            'yearly',
            boundary.priorPeriodKey,
            boundary.prior,
            CLOSED_PERIOD_TTL_SECONDS,
          )
        : Promise.resolve(null),
    ]);

    return {
      reportType: 'yearly',
      periodKey: boundary.periodKey,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      monthByMonthTrend,
      categoryBreakdown,
      yearOverYearComparison: priorTotals,
    };
  }

  /**
   * TASK-REP-001 (remaining scope, §9.1.4 row 3) — the 5th cached calendar
   * report, closing the gap `computeMonthlyBoundary`'s own doc comment
   * describes. Same cache-then-SQL shape as `generateWeekly`/`generateYearly`
   * (in-progress-period TTL for the current month, closed-period TTL for
   * the completed prior month's comparison).
   *
   * `budgetPerformance`/`totalSaved` are the two elements not shared with
   * any sibling report type: `budgetPerformance` reuses
   * `BudgetRepository.computeUtilizationForAllActive` directly (FR-FIN-031
   * — never a second utilization computation); `totalSaved` is
   * `totalIncome − totalExpense`, precision-safe via `subtractDecimalAmounts`
   * (no new formula, a direct derivation of two already-computed figures).
   */
  async generateMonthly(
    userId: string,
    asOf: Date = new Date(),
    topMerchantsLimit = 5,
  ): Promise<MonthlyReport> {
    if (!this.budgetRepository) {
      throw new Error(
        'GenerateReportUseCase.generateMonthly requires budgetRepository to be provided.',
      );
    }
    const budgetRepository = this.budgetRepository;

    const boundary = computeMonthlyBoundary(asOf);
    const earliestTransactionDate =
      await this.reportQueryRepository.getEarliestTransactionDate(userId);
    const hasPriorPeriod =
      earliestTransactionDate !== null && earliestTransactionDate < boundary.current.start;

    const [totals, categoryBreakdown, merchantBreakdown, budgetUtilizations, priorTotals] =
      await Promise.all([
        this.getCachedOrComputedTotals(
          userId,
          'monthly',
          boundary.periodKey,
          boundary.current,
          IN_PROGRESS_PERIOD_TTL_SECONDS,
        ),
        this.reportQueryRepository.getCategoryBreakdown(userId, boundary.current, {
          transactionType: 'EXPENSE',
        }),
        this.reportQueryRepository.getMerchantBreakdown(userId, boundary.current, {
          transactionType: 'EXPENSE',
        }),
        budgetRepository.computeUtilizationForAllActive(userId, asOf),
        hasPriorPeriod
          ? this.getCachedOrComputedTotals(
              userId,
              'monthly',
              boundary.priorPeriodKey,
              boundary.prior,
              CLOSED_PERIOD_TTL_SECONDS,
            )
          : Promise.resolve(null),
      ]);

    return {
      reportType: 'monthly',
      periodKey: boundary.periodKey,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      totalSaved: subtractDecimalAmounts(totals.totalIncome, totals.totalExpense),
      categoryBreakdown,
      topMerchants: merchantBreakdown.slice(0, topMerchantsLimit),
      budgetPerformance: budgetUtilizations.map((u) => ({
        budgetId: u.budget.id,
        scopeType: u.budget.scopeType,
        categoryId: u.budget.categoryId,
        limitAmount: u.budget.limitAmount,
        usedAmount: u.usedAmount,
        utilizationPercent: u.utilizationPercent,
      })),
      priorMonthComparison: priorTotals,
    };
  }

  /**
   * TASK-REP-001 (remaining scope, §9.1.4 row 9, §8.14.3). `totalExpense`/
   * `totalIncome`/`periodicTrend` reuse the existing (non-FX-converted)
   * `getTotals`/`getPeriodicBreakdown` primitives — the SAME "income vs
   * expense" shape every other report type already uses, structurally
   * BR-REP-003-compliant since `transactions` never contains a `DEBT_*` row
   * (Debt lives entirely in separate tables). `netCashFlow`/`fullCashFlow`
   * are the precision-safe, FX-converted TASK-FIN-008 figures, via
   * `ReportQueryRepository.getCashFlow` (never reimplemented here).
   *
   * `fullCashFlow` opt-in per FR-CSF-002 — `options.fullCashFlow` must be
   * explicitly `true`; omitted or `false` computes only the standard
   * `netCashFlow` (`fullCashFlow: null` in the result), never silently
   * defaulted to the broader view.
   */
  async generateCashFlow(
    userId: string,
    range: ReportDateRange,
    defaultCurrency: string,
    options: { fullCashFlow?: boolean } = {},
  ): Promise<CashFlowReport> {
    const includeFullCashFlow = options.fullCashFlow === true;
    const [totals, periodicTrend, cashFlow] = await Promise.all([
      this.reportQueryRepository.getTotals(userId, range),
      this.reportQueryRepository.getPeriodicBreakdown(userId, range, 'month'),
      this.reportQueryRepository.getCashFlow(userId, range, defaultCurrency, includeFullCashFlow),
    ]);

    return {
      reportType: 'cash_flow',
      range,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      periodicTrend,
      netCashFlow: cashFlow.netCashFlow,
      fullCashFlow: cashFlow.fullCashFlow,
    };
  }

  /**
   * TASK-REP-001 (remaining scope, §9.1.4 row 11). A point-in-time snapshot
   * (like `/debts`, which §9.1.4 explicitly says this report doubles for),
   * not a date-range report — `asOf` is only the reference date for
   * `overdueDays`. `DebtRepository.findOpenByUserId`/`findSettledByUserId`
   * are reused unchanged (FR-FIN-031); `computeDebtOverdueDays` is the only
   * new computation, pure date arithmetic over already-fetched entities, no
   * new query.
   */
  async generateDebtSummary(userId: string, asOf: Date = new Date()): Promise<DebtSummaryReport> {
    if (!this.debtRepository) {
      throw new Error(
        'GenerateReportUseCase.generateDebtSummary requires debtRepository to be provided.',
      );
    }
    const debtRepository = this.debtRepository;

    const [openDebts, settledDebts] = await Promise.all([
      debtRepository.findOpenByUserId(userId),
      debtRepository.findSettledByUserId(userId),
    ]);

    const toOpenEntry = (debt: (typeof openDebts)[number]): OpenDebtSummaryEntry => ({
      debtId: debt.id,
      direction: debt.direction,
      counterpartyName: debt.counterpartyName,
      originalAmount: debt.originalAmount,
      outstandingBalance: debt.outstandingBalance,
      currency: debt.currency,
      dueDate: debt.dueDate,
      overdueDays: computeDebtOverdueDays(debt.dueDate, asOf),
    });

    return {
      reportType: 'debt_summary',
      openDebtsGiven: openDebts.filter((d) => d.direction === 'given').map(toOpenEntry),
      openDebtsReceived: openDebts.filter((d) => d.direction === 'received').map(toOpenEntry),
      settledDebts: settledDebts.map((debt) => ({
        debtId: debt.id,
        direction: debt.direction,
        counterpartyName: debt.counterpartyName,
        originalAmount: debt.originalAmount,
        currency: debt.currency,
        status: debt.status as 'repaid' | 'forgiven',
        settledAt: debt.updatedAt,
      })),
    };
  }

  /** Never cached — see this class's own doc comment for why. */
  async generateCategoryReport(
    userId: string,
    categoryId: string,
    range: ReportDateRange,
    largestTransactionsLimit = 5,
  ): Promise<CategoryReport> {
    const filters = { categoryId };
    const [trend, merchantBreakdown, largestTransactions] = await Promise.all([
      this.reportQueryRepository.getPeriodicBreakdown(userId, range, 'month', filters),
      this.reportQueryRepository.getMerchantBreakdown(userId, range, filters),
      this.reportQueryRepository.getLargestTransactions(
        userId,
        range,
        filters,
        largestTransactionsLimit,
      ),
    ]);

    return {
      reportType: 'category',
      categoryId,
      range,
      trend,
      merchantBreakdown,
      largestTransactions,
    };
  }

  /** Never cached — see this class's own doc comment for why. */
  async generateMerchantReport(
    userId: string,
    merchant: string,
    range: ReportDateRange,
  ): Promise<MerchantReport> {
    const filters = { merchant };
    const [totals, transactionCount, trend] = await Promise.all([
      this.reportQueryRepository.getTotals(userId, range, filters),
      this.reportQueryRepository.getTransactionCount(userId, range, filters),
      this.reportQueryRepository.getPeriodicBreakdown(userId, range, 'month', filters),
    ]);

    return {
      reportType: 'merchant',
      merchant,
      range,
      totalAmount: totals.totalExpense,
      transactionCount,
      trend,
    };
  }

  /** NEVER cached (NFR-REP-002's own text: a custom range "cannot benefit from the same period-aligned caching as calendar periods") — no cache GET/SET call is made for this report type at all. */
  async generateCustomRange(userId: string, range: ReportDateRange): Promise<CustomRangeReport> {
    const [totals, categoryBreakdown, merchantBreakdown] = await Promise.all([
      this.reportQueryRepository.getTotals(userId, range),
      this.reportQueryRepository.getCategoryBreakdown(userId, range, {
        transactionType: 'EXPENSE',
      }),
      this.reportQueryRepository.getMerchantBreakdown(userId, range),
    ]);

    return {
      reportType: 'custom_range',
      range,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      categoryBreakdown,
      merchantBreakdown,
    };
  }

  /**
   * §9.5.5: "presentation composition, not new computation" — reuses
   * `getPeriodicBreakdown`/`getCategoryBreakdown` directly, no cache entry
   * of its own, no dedicated SQL beyond what those two already issue.
   */
  async generateTrendAnalysis(
    userId: string,
    range: ReportDateRange,
  ): Promise<TrendAnalysisReport> {
    const midpoint = new Date(
      range.start.getTime() + (range.end.getTime() - range.start.getTime()) / 2,
    );
    const firstHalf: ReportDateRange = { start: range.start, end: midpoint };
    const secondHalf: ReportDateRange = { start: midpoint, end: range.end };

    const [monthlyTrend, firstHalfCategories, secondHalfCategories] = await Promise.all([
      this.reportQueryRepository.getPeriodicBreakdown(userId, range, 'month', {
        transactionType: 'EXPENSE',
      }),
      this.reportQueryRepository.getCategoryBreakdown(userId, firstHalf, {
        transactionType: 'EXPENSE',
      }),
      this.reportQueryRepository.getCategoryBreakdown(userId, secondHalf, {
        transactionType: 'EXPENSE',
      }),
    ]);

    return {
      reportType: 'trend_analysis',
      range,
      monthlyTrend,
      categoryTrajectory: computeCategoryTrajectory(firstHalfCategories, secondHalfCategories),
    };
  }

  /**
   * FR-REP-009's cache-then-SQL order, applied to a single period's totals:
   * Redis GET first, unconditionally; SQL only on a genuine cache miss;
   * result SET back with the caller-supplied TTL. `ttlSeconds` is the only
   * thing distinguishing an in-progress-period call from a closed-period
   * call — the method itself has no notion of "current vs. prior."
   */
  private async getCachedOrComputedTotals(
    userId: string,
    reportType: ReportPeriodType,
    periodKey: string,
    range: ReportDateRange,
    ttlSeconds: number,
  ): Promise<ReportPeriodTotals> {
    const cached = await this.reportCacheRepository.get(userId, reportType, periodKey);
    if (cached !== null) {
      return JSON.parse(cached) as ReportPeriodTotals;
    }

    const computed = await this.reportQueryRepository.getTotals(userId, range);
    await this.reportCacheRepository.set(
      userId,
      reportType,
      periodKey,
      JSON.stringify(computed),
      ttlSeconds,
    );
    return computed;
  }

  private async getDailyAverageWindowExpense(
    userId: string,
    asOf: Date,
  ): Promise<{ averageDailyExpense: string } | null> {
    const windowEnd = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - DAILY_AVERAGE_WINDOW_DAYS);

    const earliestTransactionDate =
      await this.reportQueryRepository.getEarliestTransactionDate(userId);
    if (earliestTransactionDate === null || earliestTransactionDate >= windowEnd) {
      return null;
    }

    const totals = await this.reportQueryRepository.getTotals(
      userId,
      { start: windowStart, end: windowEnd },
      { transactionType: 'EXPENSE' },
    );
    return {
      averageDailyExpense: divideDecimalStringByInteger(
        totals.totalExpense,
        DAILY_AVERAGE_WINDOW_DAYS,
      ),
    };
  }
}

/** `Decimal(18,2)` everywhere in this schema — scaled BigInt division, never a JS float (DB-P3/FR-DB-027), rounded to the nearest cent. */
function divideDecimalStringByInteger(value: string, divisor: number): string {
  const [whole, fraction = ''] = value.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  const cents = BigInt(whole.replace('-', '')) * 100n + BigInt(paddedFraction);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const divisorBig = BigInt(divisor);
  // Round-half-up at the cent level.
  const resultCents = sign * ((cents + divisorBig / 2n) / divisorBig);
  const negative = resultCents < 0n;
  const absCents = negative ? -resultCents : resultCents;
  const wholePart = absCents / 100n;
  const fractionPart = (absCents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${wholePart}.${fractionPart}`;
}

/**
 * A category's total moving by more than 10% between the two halves of the
 * requested range is "increasing"/"decreasing"; otherwise "flat" — a
 * judgment-call threshold (§9.1.4's "category trajectory (increasing/
 * decreasing)" names the concept but no PRD text gives a numeric
 * threshold), documented rather than silently invented.
 */
const TRAJECTORY_THRESHOLD_PERCENT = 10;

function computeCategoryTrajectory(
  firstHalf: CategoryAmount[],
  secondHalf: CategoryAmount[],
): CategoryTrajectory[] {
  const allCategoryIds = new Set([
    ...firstHalf.map((c) => c.categoryId),
    ...secondHalf.map((c) => c.categoryId),
  ]);

  return Array.from(allCategoryIds).map((categoryId) => {
    const firstHalfTotal =
      firstHalf.find((c) => c.categoryId === categoryId)?.totalAmount ?? '0.00';
    const secondHalfTotal =
      secondHalf.find((c) => c.categoryId === categoryId)?.totalAmount ?? '0.00';
    return {
      categoryId,
      direction: classifyTrajectory(firstHalfTotal, secondHalfTotal),
      firstHalfTotal,
      secondHalfTotal,
    };
  });
}

function toCents(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  const sign = whole.startsWith('-') ? -1n : 1n;
  return sign * (BigInt(whole.replace('-', '')) * 100n + BigInt(paddedFraction));
}

function classifyTrajectory(
  firstHalfTotal: string,
  secondHalfTotal: string,
): CategoryTrajectoryDirection {
  const firstCents = toCents(firstHalfTotal);
  const secondCents = toCents(secondHalfTotal);
  if (firstCents === 0n) {
    return secondCents === 0n ? 'flat' : 'increasing';
  }
  const changePercent =
    ((secondCents - firstCents) * 100n) / (firstCents < 0n ? -firstCents : firstCents);
  if (changePercent >= BigInt(TRAJECTORY_THRESHOLD_PERCENT)) {
    return 'increasing';
  }
  if (changePercent <= -BigInt(TRAJECTORY_THRESHOLD_PERCENT)) {
    return 'decreasing';
  }
  return 'flat';
}

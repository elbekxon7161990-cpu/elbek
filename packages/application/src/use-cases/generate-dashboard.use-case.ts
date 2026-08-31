import { Inject, Injectable } from '@nestjs/common';
import type {
  BudgetRepository,
  BudgetUtilization,
  CategoryAmount,
  Debt,
  DebtDirection,
  DebtRepository,
  DraftRepository,
  ReportQueryRepository,
  UserRepository,
} from '@afa/domain';
import {
  addDecimalAmounts,
  BUDGET_REPOSITORY,
  compareDecimalAmounts,
  computeMonthlyBoundary,
  DEBT_REPOSITORY,
  DRAFT_REPOSITORY,
  REPORT_QUERY_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import { UserNotFoundError } from '../errors/user-not-found.error';

const TOP_CATEGORIES_LIMIT = 3;

/**
 * A direction's open debts, grouped by currency — never a single summed
 * figure. Debts of different currencies cannot be added together as raw
 * decimal strings without an FX conversion this Fast Path deliberately does
 * not perform (§9.8.2's "optimized for latency over completeness"; the
 * existing `/debts` command, `renderDebtsList`, makes the identical choice —
 * it never sums across debts either, only lists them per-currency).
 */
export interface DashboardDebtDirectionSummary {
  readonly count: number;
  readonly totalOutstandingByCurrency: readonly {
    readonly currency: string;
    readonly totalOutstanding: string;
  }[];
}

export interface DashboardSummary {
  readonly kind: 'summary';
  readonly periodKey: string;
  readonly totalExpense: string;
  readonly totalIncome: string;
  readonly netCashFlow: string;
  /** Sorted descending by amount (per `getCategoryBreakdown`'s own contract), sliced to the top 3. */
  readonly topCategories: readonly CategoryAmount[];
  /** §9.8.3: "budget_utilization for the overall-scope budget, if set" — `null` when the user has no `'overall'`-scope budget, never a misleading 0%. */
  readonly overallBudgetUtilization: BudgetUtilization | null;
  readonly openDebtsGiven: DashboardDebtDirectionSummary;
  readonly openDebtsReceived: DashboardDebtDirectionSummary;
  readonly pendingDraftCount: number;
}

/** §9.3.6/AC's "brand-new user with no data" case — a friendly onboarding response, never a wall of zeros. */
export interface DashboardEmpty {
  readonly kind: 'empty';
}

export type DashboardResult = DashboardSummary | DashboardEmpty;

/**
 * TASK-REP-004 (Chapter 9 §9.3, §9.8) — `/dashboard`'s dedicated Fast Path
 * (§9.8's own glossary: "Dashboard's dedicated, narrower query path,
 * distinct from the Report Service's general pipeline, optimized for
 * latency over completeness"). Deliberately does NOT depend on
 * `GenerateReportUseCase` — composes the same authoritative repository
 * ports directly, per ADR-CMC-001 ("Dashboard and Report Service
 * Deliberately Do Not Share an Implementation"). Never re-derives a formula
 * `GenerateReportUseCase`/`ListBudgetsUseCase` already own:
 * `computeUtilizationForAllActive` (§8.14.4 `budget_utilization`) and
 * `getCashFlow` (§8.14.3, TASK-FIN-008) are called exactly as those existing
 * consumers call them, per BR-CMC-002's "identical underlying calculation"
 * requirement.
 *
 * FR-DSH-005 — the six queries behind §9.8.3's table run concurrently
 * (`Promise.all`), never sequentially. ADR-CMC-004 explicitly does not wrap
 * them in one database transaction — independent reads, with a small,
 * accepted cross-figure staleness window, not a defect.
 *
 * The current-month boundary is computed the same UTC-calendar way
 * `GenerateReportUseCase.generateMonthly` already does (`computeMonthlyBoundary`,
 * no user-timezone adjustment) — BR-CMC-002 requires the current-month spend
 * figure to match exactly between Dashboard and a Monthly report; using a
 * timezone-shifted boundary here instead would silently violate that.
 */
@Injectable()
export class GenerateDashboardUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(REPORT_QUERY_REPOSITORY)
    private readonly reportQueryRepository: ReportQueryRepository,
    @Inject(BUDGET_REPOSITORY) private readonly budgetRepository: BudgetRepository,
    @Inject(DEBT_REPOSITORY) private readonly debtRepository: DebtRepository,
    @Inject(DRAFT_REPOSITORY) private readonly draftRepository: DraftRepository,
  ) {}

  async execute(userId: string, asOf: Date = new Date()): Promise<DashboardResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const boundary = computeMonthlyBoundary(asOf);

    const [totals, topCategoriesRaw, cashFlow, budgetUtilizations, openDebts, activeDrafts] =
      await Promise.all([
        this.reportQueryRepository.getTotals(userId, boundary.current),
        this.reportQueryRepository.getCategoryBreakdown(userId, boundary.current, {
          transactionType: 'EXPENSE',
        }),
        this.reportQueryRepository.getCashFlow(
          userId,
          boundary.current,
          user.defaultCurrency,
          false,
        ),
        this.budgetRepository.computeUtilizationForAllActive(userId, asOf),
        this.debtRepository.findOpenByUserId(userId),
        this.draftRepository.findActiveByUserId(userId),
      ]);

    const topCategories = topCategoriesRaw.slice(0, TOP_CATEGORIES_LIMIT);
    const overallBudgetUtilization =
      budgetUtilizations.find((u) => u.budget.scopeType === 'overall') ?? null;
    const openDebtsGiven = summarizeDebtsByDirection(openDebts, 'given');
    const openDebtsReceived = summarizeDebtsByDirection(openDebts, 'received');
    const pendingDraftCount = activeDrafts.length;

    const isZero = (amount: string): boolean => compareDecimalAmounts(amount, '0') === 0;
    const isEmpty =
      isZero(totals.totalExpense) &&
      isZero(totals.totalIncome) &&
      topCategories.length === 0 &&
      overallBudgetUtilization === null &&
      openDebtsGiven.count === 0 &&
      openDebtsReceived.count === 0 &&
      pendingDraftCount === 0;

    if (isEmpty) {
      return { kind: 'empty' };
    }

    return {
      kind: 'summary',
      periodKey: boundary.periodKey,
      totalExpense: totals.totalExpense,
      totalIncome: totals.totalIncome,
      netCashFlow: cashFlow.netCashFlow,
      topCategories,
      overallBudgetUtilization,
      openDebtsGiven,
      openDebtsReceived,
      pendingDraftCount,
    };
  }
}

function summarizeDebtsByDirection(
  debts: readonly Debt[],
  direction: DebtDirection,
): DashboardDebtDirectionSummary {
  const matching = debts.filter((debt) => debt.direction === direction);
  const totalsByCurrency = new Map<string, string>();
  for (const debt of matching) {
    const existing = totalsByCurrency.get(debt.currency) ?? '0.00';
    totalsByCurrency.set(debt.currency, addDecimalAmounts(existing, debt.outstandingBalance));
  }
  return {
    count: matching.length,
    totalOutstandingByCurrency: Array.from(totalsByCurrency, ([currency, totalOutstanding]) => ({
      currency,
      totalOutstanding,
    })),
  };
}

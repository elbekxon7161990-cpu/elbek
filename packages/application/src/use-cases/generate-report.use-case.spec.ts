import { describe, expect, it, vi } from 'vitest';
import type {
  Budget,
  BudgetRepository,
  BudgetUtilization,
  CategoryAmount,
  Debt,
  DebtRepository,
  MerchantAmount,
  ReportCacheRepository,
  ReportDateRange,
  ReportPeriodBucket,
  ReportPeriodTotals,
  ReportQueryFilters,
  ReportQueryRepository,
  ReportTransactionSummary,
} from '@afa/domain';

import { GenerateReportUseCase } from './generate-report.use-case';

const USER_ID = 'user-1';

type FakeReportQueryRepository = ReportQueryRepository & {
  getTotals: ReturnType<typeof vi.fn>;
  getCategoryBreakdown: ReturnType<typeof vi.fn>;
  getMerchantBreakdown: ReturnType<typeof vi.fn>;
  getPeriodicBreakdown: ReturnType<typeof vi.fn>;
  getLargestTransactions: ReturnType<typeof vi.fn>;
  getTransactionCount: ReturnType<typeof vi.fn>;
  getEarliestTransactionDate: ReturnType<typeof vi.fn>;
  getCashFlow: ReturnType<typeof vi.fn>;
};

function fakeQueryRepository(
  overrides: Partial<FakeReportQueryRepository> = {},
): FakeReportQueryRepository {
  return {
    getTotals: vi.fn().mockResolvedValue({
      totalExpense: '0.00',
      totalIncome: '0.00',
    } satisfies ReportPeriodTotals),
    getCategoryBreakdown: vi.fn().mockResolvedValue([] satisfies CategoryAmount[]),
    getMerchantBreakdown: vi.fn().mockResolvedValue([] satisfies MerchantAmount[]),
    getPeriodicBreakdown: vi.fn().mockResolvedValue([] satisfies ReportPeriodBucket[]),
    getLargestTransactions: vi.fn().mockResolvedValue([] satisfies ReportTransactionSummary[]),
    getTransactionCount: vi.fn().mockResolvedValue(0),
    getEarliestTransactionDate: vi.fn().mockResolvedValue(new Date('2020-01-01T00:00:00Z')),
    getCashFlow: vi.fn().mockResolvedValue({ netCashFlow: '0.00', fullCashFlow: null }),
    searchTransactions: vi.fn(),
    ...overrides,
  };
}

type FakeReportCacheRepository = ReportCacheRepository & {
  invalidate: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

function fakeCacheRepository(
  overrides: Partial<FakeReportCacheRepository> = {},
): FakeReportCacheRepository {
  return {
    invalidate: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

type FakeDebtRepository = DebtRepository & {
  findOpenByUserId: ReturnType<typeof vi.fn>;
  findSettledByUserId: ReturnType<typeof vi.fn>;
};

function fakeDebtRepository(overrides: Partial<FakeDebtRepository> = {}): FakeDebtRepository {
  return {
    findById: vi.fn(),
    findOpenByUserId: vi.fn().mockResolvedValue([]),
    findSettledByUserId: vi.fn().mockResolvedValue([]),
    findOpenByCounterparty: vi.fn(),
    create: vi.fn(),
    logRepayment: vi.fn(),
    forgive: vi.fn(),
    ...overrides,
  } as FakeDebtRepository;
}

function fakeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'debt-1',
    userId: USER_ID,
    direction: 'given',
    counterpartyName: 'Alice',
    counterpartyRefId: null,
    originalAmount: '1000.00',
    outstandingBalance: '1000.00',
    currency: 'UZS',
    transactionDate: new Date('2026-01-01'),
    dueDate: null,
    status: 'open',
    notes: null,
    originalText: 'lent 1000',
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as Debt;
}

type FakeBudgetRepository = BudgetRepository & {
  computeUtilizationForAllActive: ReturnType<typeof vi.fn>;
};

function fakeBudgetRepository(overrides: Partial<FakeBudgetRepository> = {}): FakeBudgetRepository {
  return {
    findById: vi.fn(),
    findActiveByUserId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    computeUtilization: vi.fn(),
    computeUtilizationForAllActive: vi.fn().mockResolvedValue([]),
    findDueForRollover: vi.fn(),
    rolloverPeriod: vi.fn(),
    ...overrides,
  } as FakeBudgetRepository;
}

function fakeBudgetUtilization(overrides: Partial<BudgetUtilization> = {}): BudgetUtilization {
  const budget: Budget = {
    id: 'budget-1',
    userId: USER_ID,
    scopeType: 'overall',
    categoryId: null,
    limitAmount: '1000000.00',
    currency: 'UZS',
    periodType: 'monthly',
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'),
    status: 'active',
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as Budget;
  return {
    budget,
    usedAmount: '200000.00',
    utilizationPercent: 20,
    remainingAmount: '800000.00',
    daysRemainingInPeriod: 15,
    ...overrides,
  };
}

const ASOF = new Date('2026-01-15T12:00:00Z'); // Thursday, ISO week 2026-W03, Q1, year 2026

describe('GenerateReportUseCase', () => {
  describe('generateDaily', () => {
    it('queries the cache before SQL (cache-miss branch): computes via SQL and stores the result', async () => {
      const queryRepo = fakeQueryRepository({
        getTotals: vi.fn().mockResolvedValue({ totalExpense: '15000.00', totalIncome: '0.00' }),
      });
      const cacheRepo = fakeCacheRepository();
      const useCase = new GenerateReportUseCase(queryRepo, cacheRepo);

      const report = await useCase.generateDaily(USER_ID, ASOF);

      expect(cacheRepo.get).toHaveBeenCalledWith(USER_ID, 'daily', '2026-01-15');
      expect(queryRepo.getTotals).toHaveBeenCalled();
      expect(cacheRepo.set).toHaveBeenCalledWith(
        USER_ID,
        'daily',
        '2026-01-15',
        JSON.stringify({ totalExpense: '15000.00', totalIncome: '0.00' }),
        60,
      );
      expect(report.totalExpense).toBe('15000.00');
      expect(report.periodKey).toBe('2026-01-15');
    });

    it('cache-hit branch: returns the cached value and never calls SQL for totals', async () => {
      const queryRepo = fakeQueryRepository();
      const cacheRepo = fakeCacheRepository({
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ totalExpense: '9999.00', totalIncome: '0.00' })),
      });
      const useCase = new GenerateReportUseCase(queryRepo, cacheRepo);

      const report = await useCase.generateDaily(USER_ID, ASOF);

      expect(report.totalExpense).toBe('9999.00');
      expect(cacheRepo.set).not.toHaveBeenCalled();
      // getTotals is still called for other purposes (the daily-average window) — assert
      // it was never called with the CURRENT day's own range specifically.
      const totalsCalls = queryRepo.getTotals.mock.calls as [
        string,
        ReportDateRange,
        ReportQueryFilters?,
      ][];
      const calledForCurrentDay = totalsCalls.some(
        ([, range]) => range.start.toISOString() === '2026-01-15T00:00:00.000Z',
      );
      expect(calledForCurrentDay).toBe(false);
    });

    it('filters category breakdown to EXPENSE only', async () => {
      const queryRepo = fakeQueryRepository();
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      await useCase.generateDaily(USER_ID, ASOF);

      expect(queryRepo.getCategoryBreakdown).toHaveBeenCalledWith(USER_ID, expect.any(Object), {
        transactionType: 'EXPENSE',
      });
    });

    it('comparison to daily average is null when the user has no transaction history', async () => {
      const queryRepo = fakeQueryRepository({
        getEarliestTransactionDate: vi.fn().mockResolvedValue(null),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      const report = await useCase.generateDaily(USER_ID, ASOF);

      expect(report.comparisonToDailyAverage).toBeNull();
    });
  });

  describe('generateWeekly', () => {
    it('computes the day-by-day trend and prior-week comparison', async () => {
      const dayBuckets: ReportPeriodBucket[] = [
        { bucketStart: new Date('2026-01-12'), totalExpense: '100.00', totalIncome: '0.00' },
      ];
      const queryRepo = fakeQueryRepository({
        getPeriodicBreakdown: vi.fn().mockResolvedValue(dayBuckets),
        getTotals: vi.fn().mockResolvedValue({ totalExpense: '500.00', totalIncome: '0.00' }),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      const report = await useCase.generateWeekly(USER_ID, ASOF);

      expect(report.periodKey).toBe('2026-W03');
      expect(report.dayByDayTrend).toEqual(dayBuckets);
      expect(queryRepo.getPeriodicBreakdown).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Object),
        'day',
      );
      expect(report.priorWeekComparison).toEqual({ totalExpense: '500.00', totalIncome: '0.00' });
    });

    it("omits the prior-week comparison (null, not a fabricated zero) for a user's very first week", async () => {
      const queryRepo = fakeQueryRepository({
        getEarliestTransactionDate: vi.fn().mockResolvedValue(new Date('2026-01-13T00:00:00Z')), // inside the current week
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      const report = await useCase.generateWeekly(USER_ID, ASOF);

      expect(report.priorWeekComparison).toBeNull();
    });
  });

  describe('generateQuarterly', () => {
    it('computes monthly trend and current-vs-prior category shift', async () => {
      const queryRepo = fakeQueryRepository({
        getCategoryBreakdown: vi
          .fn()
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '100.00' }])
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '50.00' }]),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      const report = await useCase.generateQuarterly(USER_ID, ASOF);

      expect(report.periodKey).toBe('2026-Q1');
      expect(report.categoryShift.current).toEqual([
        { categoryId: 'cat-1', totalAmount: '100.00' },
      ]);
      expect(report.categoryShift.prior).toEqual([{ categoryId: 'cat-1', totalAmount: '50.00' }]);
    });

    it('is never cached — no cache GET/SET call for the quarterly totals', async () => {
      const cacheRepo = fakeCacheRepository();
      const useCase = new GenerateReportUseCase(fakeQueryRepository(), cacheRepo);

      await useCase.generateQuarterly(USER_ID, ASOF);

      // Quarterly's own report has no single "totals" cache entry in this
      // implementation (monthly trend + category shift only) — confirm no
      // stray cache traffic occurred for it.
      expect(cacheRepo.get).not.toHaveBeenCalled();
      expect(cacheRepo.set).not.toHaveBeenCalled();
    });
  });

  describe('generateYearly', () => {
    it('computes year-over-year comparison when prior-year data exists (FR-REP-023)', async () => {
      const queryRepo = fakeQueryRepository({
        getEarliestTransactionDate: vi.fn().mockResolvedValue(new Date('2024-06-01T00:00:00Z')),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      const report = await useCase.generateYearly(USER_ID, ASOF);

      expect(report.periodKey).toBe('2026');
      expect(report.yearOverYearComparison).not.toBeNull();
    });

    it('omits year-over-year comparison when the user has no data before the prior year', async () => {
      const queryRepo = fakeQueryRepository({
        getEarliestTransactionDate: vi.fn().mockResolvedValue(new Date('2026-01-10T00:00:00Z')),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());

      const report = await useCase.generateYearly(USER_ID, ASOF);

      expect(report.yearOverYearComparison).toBeNull();
    });
  });

  describe('generateCategoryReport', () => {
    it('scopes every query by categoryId and is never cached', async () => {
      const queryRepo = fakeQueryRepository();
      const cacheRepo = fakeCacheRepository();
      const useCase = new GenerateReportUseCase(queryRepo, cacheRepo);
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

      await useCase.generateCategoryReport(USER_ID, 'cat-groceries', range, 3);

      expect(queryRepo.getPeriodicBreakdown).toHaveBeenCalledWith(USER_ID, range, 'month', {
        categoryId: 'cat-groceries',
      });
      expect(queryRepo.getMerchantBreakdown).toHaveBeenCalledWith(USER_ID, range, {
        categoryId: 'cat-groceries',
      });
      expect(queryRepo.getLargestTransactions).toHaveBeenCalledWith(
        USER_ID,
        range,
        { categoryId: 'cat-groceries' },
        3,
      );
      expect(cacheRepo.get).not.toHaveBeenCalled();
      expect(cacheRepo.set).not.toHaveBeenCalled();
    });
  });

  describe('generateMerchantReport', () => {
    it('scopes every query by merchant and is never cached', async () => {
      const queryRepo = fakeQueryRepository({
        getTotals: vi.fn().mockResolvedValue({ totalExpense: '250.00', totalIncome: '0.00' }),
        getTransactionCount: vi.fn().mockResolvedValue(4),
      });
      const cacheRepo = fakeCacheRepository();
      const useCase = new GenerateReportUseCase(queryRepo, cacheRepo);
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

      const report = await useCase.generateMerchantReport(USER_ID, 'Korzinka', range);

      expect(queryRepo.getTotals).toHaveBeenCalledWith(USER_ID, range, { merchant: 'Korzinka' });
      expect(queryRepo.getTransactionCount).toHaveBeenCalledWith(USER_ID, range, {
        merchant: 'Korzinka',
      });
      expect(report.totalAmount).toBe('250.00');
      expect(report.transactionCount).toBe(4);
      expect(cacheRepo.get).not.toHaveBeenCalled();
      expect(cacheRepo.set).not.toHaveBeenCalled();
    });
  });

  describe('generateCustomRange', () => {
    it('accepts an arbitrary date range and is NEVER cached (NFR-REP-002)', async () => {
      const cacheRepo = fakeCacheRepository();
      const useCase = new GenerateReportUseCase(fakeQueryRepository(), cacheRepo);
      const range: ReportDateRange = { start: new Date('2026-05-01'), end: new Date('2026-05-16') };

      await useCase.generateCustomRange(USER_ID, range);

      expect(cacheRepo.get).not.toHaveBeenCalled();
      expect(cacheRepo.set).not.toHaveBeenCalled();
    });

    it('does not filter by category/merchant by default — a true whole-range summary', async () => {
      const queryRepo = fakeQueryRepository();
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-05-01'), end: new Date('2026-05-16') };

      await useCase.generateCustomRange(USER_ID, range);

      expect(queryRepo.getTotals).toHaveBeenCalledWith(USER_ID, range);
    });
  });

  describe('generateTrendAnalysis', () => {
    it('composes from getPeriodicBreakdown/getCategoryBreakdown only — no cache entry of its own', async () => {
      const cacheRepo = fakeCacheRepository();
      const queryRepo = fakeQueryRepository();
      const useCase = new GenerateReportUseCase(queryRepo, cacheRepo);
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-07-01') };

      await useCase.generateTrendAnalysis(USER_ID, range);

      expect(queryRepo.getPeriodicBreakdown).toHaveBeenCalledWith(USER_ID, range, 'month', {
        transactionType: 'EXPENSE',
      });
      expect(cacheRepo.get).not.toHaveBeenCalled();
      expect(cacheRepo.set).not.toHaveBeenCalled();
    });

    it('classifies a category trajectory as increasing when its second-half total is well above its first-half total', async () => {
      const queryRepo = fakeQueryRepository({
        getCategoryBreakdown: vi
          .fn()
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '100.00' }]) // first half
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '200.00' }]), // second half
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-07-01') };

      const report = await useCase.generateTrendAnalysis(USER_ID, range);

      expect(report.categoryTrajectory).toEqual([
        {
          categoryId: 'cat-1',
          direction: 'increasing',
          firstHalfTotal: '100.00',
          secondHalfTotal: '200.00',
        },
      ]);
    });

    it('classifies a category trajectory as flat when the change is within the threshold', async () => {
      const queryRepo = fakeQueryRepository({
        getCategoryBreakdown: vi
          .fn()
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '100.00' }])
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '103.00' }]),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-07-01') };

      const report = await useCase.generateTrendAnalysis(USER_ID, range);

      expect(report.categoryTrajectory[0]?.direction).toBe('flat');
    });

    it('classifies a category trajectory as decreasing when its second-half total drops well below its first-half total', async () => {
      const queryRepo = fakeQueryRepository({
        getCategoryBreakdown: vi
          .fn()
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '200.00' }])
          .mockResolvedValueOnce([{ categoryId: 'cat-1', totalAmount: '50.00' }]),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-07-01') };

      const report = await useCase.generateTrendAnalysis(USER_ID, range);

      expect(report.categoryTrajectory[0]?.direction).toBe('decreasing');
    });
  });

  describe('generateMonthly', () => {
    it('computes totalSaved as income minus expense, reuses cache-then-SQL, and includes budget performance', async () => {
      const queryRepo = fakeQueryRepository({
        getTotals: vi
          .fn()
          .mockResolvedValue({ totalExpense: '300000.00', totalIncome: '1000000.00' }),
      });
      const cacheRepo = fakeCacheRepository();
      const budgetRepo = fakeBudgetRepository({
        computeUtilizationForAllActive: vi.fn().mockResolvedValue([fakeBudgetUtilization()]),
      });
      const useCase = new GenerateReportUseCase(
        queryRepo,
        cacheRepo,
        fakeDebtRepository(),
        budgetRepo,
      );

      const report = await useCase.generateMonthly(USER_ID, ASOF);

      expect(report.totalSaved).toBe('700000.00');
      expect(cacheRepo.get).toHaveBeenCalledWith(USER_ID, 'monthly', '2026-01');
      expect(budgetRepo.computeUtilizationForAllActive).toHaveBeenCalledWith(USER_ID, ASOF);
      expect(report.budgetPerformance).toEqual([
        {
          budgetId: 'budget-1',
          scopeType: 'overall',
          categoryId: null,
          limitAmount: '1000000.00',
          usedAmount: '200000.00',
          utilizationPercent: 20,
        },
      ]);
    });

    it('slices top merchants to the requested limit', async () => {
      const queryRepo = fakeQueryRepository({
        getMerchantBreakdown: vi.fn().mockResolvedValue([
          { merchant: 'A', totalAmount: '300.00', transactionCount: 3 },
          { merchant: 'B', totalAmount: '200.00', transactionCount: 2 },
          { merchant: 'C', totalAmount: '100.00', transactionCount: 1 },
        ]),
      });
      const useCase = new GenerateReportUseCase(
        queryRepo,
        fakeCacheRepository(),
        fakeDebtRepository(),
        fakeBudgetRepository(),
      );

      const report = await useCase.generateMonthly(USER_ID, ASOF, 2);

      expect(report.topMerchants).toHaveLength(2);
      expect(report.topMerchants[0]?.merchant).toBe('A');
    });

    it('throws a clear error when budgetRepository was not provided', async () => {
      const useCase = new GenerateReportUseCase(fakeQueryRepository(), fakeCacheRepository());

      await expect(useCase.generateMonthly(USER_ID, ASOF)).rejects.toThrow(/budgetRepository/);
    });
  });

  describe('generateCashFlow', () => {
    it('standard mode (default): calls getCashFlow with includeFullCashFlow=false, fullCashFlow is null', async () => {
      const queryRepo = fakeQueryRepository({
        getCashFlow: vi.fn().mockResolvedValue({ netCashFlow: '700000.00', fullCashFlow: null }),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

      const report = await useCase.generateCashFlow(USER_ID, range, 'UZS');

      expect(queryRepo.getCashFlow).toHaveBeenCalledWith(USER_ID, range, 'UZS', false);
      expect(report.netCashFlow).toBe('700000.00');
      expect(report.fullCashFlow).toBeNull();
    });

    it('fullCashFlow: true explicitly requests the full view — never silently defaulted', async () => {
      const queryRepo = fakeQueryRepository({
        getCashFlow: vi
          .fn()
          .mockResolvedValue({ netCashFlow: '700000.00', fullCashFlow: '830000.00' }),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

      const report = await useCase.generateCashFlow(USER_ID, range, 'UZS', { fullCashFlow: true });

      expect(queryRepo.getCashFlow).toHaveBeenCalledWith(USER_ID, range, 'UZS', true);
      expect(report.fullCashFlow).toBe('830000.00');
    });

    it('fullCashFlow: false is explicitly the same as omitted — still standard mode', async () => {
      const queryRepo = fakeQueryRepository();
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

      await useCase.generateCashFlow(USER_ID, range, 'UZS', { fullCashFlow: false });

      expect(queryRepo.getCashFlow).toHaveBeenCalledWith(USER_ID, range, 'UZS', false);
    });

    it('includes totals and periodic trend alongside the cash-flow figures', async () => {
      const queryRepo = fakeQueryRepository({
        getTotals: vi
          .fn()
          .mockResolvedValue({ totalExpense: '300000.00', totalIncome: '1000000.00' }),
      });
      const useCase = new GenerateReportUseCase(queryRepo, fakeCacheRepository());
      const range: ReportDateRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

      const report = await useCase.generateCashFlow(USER_ID, range, 'UZS');

      expect(report.totalExpense).toBe('300000.00');
      expect(report.totalIncome).toBe('1000000.00');
      expect(queryRepo.getPeriodicBreakdown).toHaveBeenCalledWith(USER_ID, range, 'month');
    });
  });

  describe('generateDebtSummary', () => {
    it('splits open debts by direction and computes overdueDays from dueDate', async () => {
      const debtRepo = fakeDebtRepository({
        findOpenByUserId: vi
          .fn()
          .mockResolvedValue([
            fakeDebt({ id: 'd-given', direction: 'given', dueDate: new Date('2026-01-01') }),
            fakeDebt({ id: 'd-received', direction: 'received', dueDate: null }),
          ]),
      });
      const useCase = new GenerateReportUseCase(
        fakeQueryRepository(),
        fakeCacheRepository(),
        debtRepo,
      );

      const report = await useCase.generateDebtSummary(USER_ID, new Date('2026-01-15'));

      expect(report.openDebtsGiven).toHaveLength(1);
      expect(report.openDebtsGiven[0]?.debtId).toBe('d-given');
      expect(report.openDebtsGiven[0]?.overdueDays).toBe(14);
      expect(report.openDebtsReceived).toHaveLength(1);
      expect(report.openDebtsReceived[0]?.overdueDays).toBeNull();
    });

    it('includes settled (repaid/forgiven) debts from findSettledByUserId', async () => {
      const debtRepo = fakeDebtRepository({
        findSettledByUserId: vi
          .fn()
          .mockResolvedValue([
            fakeDebt({ id: 'd-repaid', status: 'repaid', outstandingBalance: '0.00' }),
            fakeDebt({ id: 'd-forgiven', status: 'forgiven' }),
          ]),
      });
      const useCase = new GenerateReportUseCase(
        fakeQueryRepository(),
        fakeCacheRepository(),
        debtRepo,
      );

      const report = await useCase.generateDebtSummary(USER_ID);

      expect(report.settledDebts.map((d) => d.status).sort()).toEqual(['forgiven', 'repaid']);
    });

    it('returns empty arrays (zero-state) when the user has no debts at all', async () => {
      const useCase = new GenerateReportUseCase(
        fakeQueryRepository(),
        fakeCacheRepository(),
        fakeDebtRepository(),
      );

      const report = await useCase.generateDebtSummary(USER_ID);

      expect(report.openDebtsGiven).toEqual([]);
      expect(report.openDebtsReceived).toEqual([]);
      expect(report.settledDebts).toEqual([]);
    });

    it('throws a clear error when debtRepository was not provided', async () => {
      const useCase = new GenerateReportUseCase(fakeQueryRepository(), fakeCacheRepository());

      await expect(useCase.generateDebtSummary(USER_ID)).rejects.toThrow(/debtRepository/);
    });
  });
});

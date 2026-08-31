import { describe, expect, it, vi } from 'vitest';
import type {
  Budget,
  BudgetRepository,
  BudgetUtilization,
  CategoryAmount,
  Debt,
  DebtRepository,
  DraftRepository,
  ReportPeriodTotals,
  ReportQueryRepository,
  TransactionDraftRecord,
  User,
  UserRepository,
} from '@afa/domain';
import { computeMonthlyBoundary } from '@afa/domain';

import { UserNotFoundError } from '../errors/user-not-found.error';
import { GenerateDashboardUseCase } from './generate-dashboard.use-case';

const USER_ID = 'user-1';
const ASOF = new Date('2026-01-15T12:00:00Z');
const RANGE = computeMonthlyBoundary(ASOF).current;

function fakeUser(overrides: Partial<User> = {}): User {
  return { id: USER_ID, defaultCurrency: 'UZS', timezone: 'UTC', ...overrides } as User;
}

type FakeUserRepository = UserRepository & { findById: ReturnType<typeof vi.fn> };

function fakeUserRepository(overrides: Partial<FakeUserRepository> = {}): FakeUserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById: vi.fn().mockResolvedValue(fakeUser()),
    create: vi.fn(),
    reactivate: vi.fn(),
    ...overrides,
  } as FakeUserRepository;
}

type FakeReportQueryRepository = ReportQueryRepository & {
  getTotals: ReturnType<typeof vi.fn>;
  getCategoryBreakdown: ReturnType<typeof vi.fn>;
  getCashFlow: ReturnType<typeof vi.fn>;
};

function fakeReportQueryRepository(
  overrides: Partial<FakeReportQueryRepository> = {},
): FakeReportQueryRepository {
  return {
    getTotals: vi.fn().mockResolvedValue({
      totalExpense: '0.00',
      totalIncome: '0.00',
    } satisfies ReportPeriodTotals),
    getCategoryBreakdown: vi.fn().mockResolvedValue([] satisfies CategoryAmount[]),
    getMerchantBreakdown: vi.fn(),
    getPeriodicBreakdown: vi.fn(),
    getLargestTransactions: vi.fn(),
    getTransactionCount: vi.fn(),
    getEarliestTransactionDate: vi.fn(),
    getCashFlow: vi.fn().mockResolvedValue({ netCashFlow: '0.00', fullCashFlow: null }),
    ...overrides,
  } as FakeReportQueryRepository;
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
    currentPeriodStart: RANGE.start,
    currentPeriodEnd: RANGE.end,
    status: 'active',
    deletedAt: null,
    createdAt: RANGE.start,
    updatedAt: RANGE.start,
  } as Budget;
  return {
    budget,
    usedAmount: '200000.00',
    utilizationPercent: 20,
    remainingAmount: '800000.00',
    daysRemainingInPeriod: 16,
    ...overrides,
  };
}

type FakeDebtRepository = DebtRepository & { findOpenByUserId: ReturnType<typeof vi.fn> };

function fakeDebtRepository(overrides: Partial<FakeDebtRepository> = {}): FakeDebtRepository {
  return {
    findById: vi.fn(),
    findOpenByUserId: vi.fn().mockResolvedValue([]),
    findSettledByUserId: vi.fn(),
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
    transactionDate: RANGE.start,
    dueDate: null,
    status: 'open',
    notes: null,
    originalText: 'lent 1000',
    deletedAt: null,
    createdAt: RANGE.start,
    updatedAt: RANGE.start,
    ...overrides,
  } as Debt;
}

type FakeDraftRepository = DraftRepository & { findActiveByUserId: ReturnType<typeof vi.fn> };

function fakeDraftRepository(overrides: Partial<FakeDraftRepository> = {}): FakeDraftRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findActiveByUserId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
    ...overrides,
  } as FakeDraftRepository;
}

function fakeDraft(overrides: Partial<TransactionDraftRecord> = {}): TransactionDraftRecord {
  return {
    id: 'draft-1',
    userId: USER_ID,
    partialData: {},
    missingFields: [],
    status: 'pending',
    originalText: 'bought something',
    sourceType: 'text',
    resolvedTransactionId: null,
    createdAt: RANGE.start,
    lastInteractionAt: RANGE.start,
    deletedAt: null,
    ...overrides,
  } as TransactionDraftRecord;
}

interface Deps {
  userRepository: FakeUserRepository;
  reportQueryRepository: FakeReportQueryRepository;
  budgetRepository: FakeBudgetRepository;
  debtRepository: FakeDebtRepository;
  draftRepository: FakeDraftRepository;
}

function makeUseCase(overrides: Partial<Deps> = {}): GenerateDashboardUseCase {
  const deps: Deps = {
    userRepository: fakeUserRepository(),
    reportQueryRepository: fakeReportQueryRepository(),
    budgetRepository: fakeBudgetRepository(),
    debtRepository: fakeDebtRepository(),
    draftRepository: fakeDraftRepository(),
    ...overrides,
  };
  return new GenerateDashboardUseCase(
    deps.userRepository,
    deps.reportQueryRepository,
    deps.budgetRepository,
    deps.debtRepository,
    deps.draftRepository,
  );
}

describe('GenerateDashboardUseCase', () => {
  it('throws UserNotFoundError when the user does not exist', async () => {
    const userRepository = fakeUserRepository({ findById: vi.fn().mockResolvedValue(null) });
    const useCase = makeUseCase({ userRepository });

    await expect(useCase.execute(USER_ID, ASOF)).rejects.toThrow(UserNotFoundError);
  });

  it('returns kind "empty" for a brand-new user with zero data across every figure', async () => {
    const useCase = makeUseCase();

    const result = await useCase.execute(USER_ID, ASOF);

    expect(result).toEqual({ kind: 'empty' });
  });

  it('runs all six queries concurrently against the current-month boundary, never delegating to the general Report Service', async () => {
    const reportQueryRepository = fakeReportQueryRepository();
    const budgetRepository = fakeBudgetRepository();
    const debtRepository = fakeDebtRepository();
    const draftRepository = fakeDraftRepository();
    const useCase = makeUseCase({
      reportQueryRepository,
      budgetRepository,
      debtRepository,
      draftRepository,
    });

    await useCase.execute(USER_ID, ASOF);

    expect(reportQueryRepository.getTotals).toHaveBeenCalledWith(USER_ID, RANGE);
    expect(reportQueryRepository.getCategoryBreakdown).toHaveBeenCalledWith(USER_ID, RANGE, {
      transactionType: 'EXPENSE',
    });
    expect(reportQueryRepository.getCashFlow).toHaveBeenCalledWith(USER_ID, RANGE, 'UZS', false);
    expect(budgetRepository.computeUtilizationForAllActive).toHaveBeenCalledWith(USER_ID, ASOF);
    expect(debtRepository.findOpenByUserId).toHaveBeenCalledWith(USER_ID);
    expect(draftRepository.findActiveByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('composes a full summary from all six data sources', async () => {
    const useCase = makeUseCase({
      reportQueryRepository: fakeReportQueryRepository({
        getTotals: vi
          .fn()
          .mockResolvedValue({ totalExpense: '300000.00', totalIncome: '1000000.00' }),
        getCategoryBreakdown: vi.fn().mockResolvedValue([
          { categoryId: 'food', totalAmount: '150000.00' },
          { categoryId: 'transport', totalAmount: '80000.00' },
          { categoryId: 'utilities', totalAmount: '50000.00' },
          { categoryId: 'other', totalAmount: '20000.00' },
        ]),
        getCashFlow: vi.fn().mockResolvedValue({ netCashFlow: '700000.00', fullCashFlow: null }),
      }),
      budgetRepository: fakeBudgetRepository({
        computeUtilizationForAllActive: vi.fn().mockResolvedValue([fakeBudgetUtilization()]),
      }),
      debtRepository: fakeDebtRepository({
        findOpenByUserId: vi.fn().mockResolvedValue([fakeDebt()]),
      }),
      draftRepository: fakeDraftRepository({
        findActiveByUserId: vi.fn().mockResolvedValue([fakeDraft()]),
      }),
    });

    const result = await useCase.execute(USER_ID, ASOF);

    expect(result.kind).toBe('summary');
    if (result.kind !== 'summary') throw new Error('expected summary');
    expect(result.totalExpense).toBe('300000.00');
    expect(result.totalIncome).toBe('1000000.00');
    expect(result.netCashFlow).toBe('700000.00');
    expect(result.topCategories).toEqual([
      { categoryId: 'food', totalAmount: '150000.00' },
      { categoryId: 'transport', totalAmount: '80000.00' },
      { categoryId: 'utilities', totalAmount: '50000.00' },
    ]);
    expect(result.overallBudgetUtilization).toEqual(fakeBudgetUtilization());
    expect(result.openDebtsGiven).toEqual({
      count: 1,
      totalOutstandingByCurrency: [{ currency: 'UZS', totalOutstanding: '1000.00' }],
    });
    expect(result.openDebtsReceived).toEqual({ count: 0, totalOutstandingByCurrency: [] });
    expect(result.pendingDraftCount).toBe(1);
  });

  it('slices category breakdown to the top 3, discarding the rest', async () => {
    const useCase = makeUseCase({
      reportQueryRepository: fakeReportQueryRepository({
        getTotals: vi.fn().mockResolvedValue({ totalExpense: '10.00', totalIncome: '0.00' }),
        getCategoryBreakdown: vi.fn().mockResolvedValue([
          { categoryId: 'a', totalAmount: '4.00' },
          { categoryId: 'b', totalAmount: '3.00' },
          { categoryId: 'c', totalAmount: '2.00' },
          { categoryId: 'd', totalAmount: '1.00' },
        ]),
      }),
    });

    const result = await useCase.execute(USER_ID, ASOF);

    expect(result.kind).toBe('summary');
    if (result.kind !== 'summary') throw new Error('expected summary');
    expect(result.topCategories).toHaveLength(3);
    expect(result.topCategories.map((c) => c.categoryId)).toEqual(['a', 'b', 'c']);
  });

  it('returns null overallBudgetUtilization when the user has only category-scope budgets, never a wrong-figure fallback', async () => {
    const categoryBudget = fakeBudgetUtilization({
      budget: {
        ...fakeBudgetUtilization().budget,
        id: 'budget-2',
        scopeType: 'category',
        categoryId: 'food',
      } as Budget,
    });
    const useCase = makeUseCase({
      reportQueryRepository: fakeReportQueryRepository({
        getTotals: vi.fn().mockResolvedValue({ totalExpense: '10.00', totalIncome: '0.00' }),
      }),
      budgetRepository: fakeBudgetRepository({
        computeUtilizationForAllActive: vi.fn().mockResolvedValue([categoryBudget]),
      }),
    });

    const result = await useCase.execute(USER_ID, ASOF);

    expect(result.kind).toBe('summary');
    if (result.kind !== 'summary') throw new Error('expected summary');
    expect(result.overallBudgetUtilization).toBeNull();
  });

  it('never sums debts of different currencies together, grouping totals per currency instead', async () => {
    const useCase = makeUseCase({
      debtRepository: fakeDebtRepository({
        findOpenByUserId: vi.fn().mockResolvedValue([
          fakeDebt({
            id: 'd1',
            direction: 'given',
            currency: 'UZS',
            outstandingBalance: '1000.00',
          }),
          fakeDebt({
            id: 'd2',
            direction: 'given',
            currency: 'USD',
            outstandingBalance: '50.00',
          }),
          fakeDebt({
            id: 'd3',
            direction: 'given',
            currency: 'UZS',
            outstandingBalance: '500.00',
          }),
        ]),
      }),
    });

    const result = await useCase.execute(USER_ID, ASOF);

    expect(result.kind).toBe('summary');
    if (result.kind !== 'summary') throw new Error('expected summary');
    expect(result.openDebtsGiven.count).toBe(3);
    expect(result.openDebtsGiven.totalOutstandingByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'UZS', totalOutstanding: '1500.00' },
        { currency: 'USD', totalOutstanding: '50.00' },
      ]),
    );
    expect(result.openDebtsGiven.totalOutstandingByCurrency).toHaveLength(2);
  });

  it('separates given and received debts into independent summaries', async () => {
    const useCase = makeUseCase({
      debtRepository: fakeDebtRepository({
        findOpenByUserId: vi
          .fn()
          .mockResolvedValue([
            fakeDebt({ id: 'd1', direction: 'given', outstandingBalance: '1000.00' }),
            fakeDebt({ id: 'd2', direction: 'received', outstandingBalance: '300.00' }),
          ]),
      }),
    });

    const result = await useCase.execute(USER_ID, ASOF);

    expect(result.kind).toBe('summary');
    if (result.kind !== 'summary') throw new Error('expected summary');
    expect(result.openDebtsGiven).toEqual({
      count: 1,
      totalOutstandingByCurrency: [{ currency: 'UZS', totalOutstanding: '1000.00' }],
    });
    expect(result.openDebtsReceived).toEqual({
      count: 1,
      totalOutstandingByCurrency: [{ currency: 'UZS', totalOutstanding: '300.00' }],
    });
  });
});

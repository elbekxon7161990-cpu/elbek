import { describe, expect, it, vi } from 'vitest';
import type { ReportQueryRepository, SearchTransactionsResult } from '@afa/domain';

import { SearchTransactionsUseCase } from './search-transactions.use-case';

const USER_ID = 'user-1';

type FakeReportQueryRepository = ReportQueryRepository & {
  searchTransactions: ReturnType<typeof vi.fn>;
};

function fakeReportQueryRepository(
  overrides: Partial<FakeReportQueryRepository> = {},
): FakeReportQueryRepository {
  return {
    getTotals: vi.fn(),
    getCategoryBreakdown: vi.fn(),
    getMerchantBreakdown: vi.fn(),
    getPeriodicBreakdown: vi.fn(),
    getLargestTransactions: vi.fn(),
    getTransactionCount: vi.fn(),
    getEarliestTransactionDate: vi.fn(),
    getCashFlow: vi.fn(),
    searchTransactions: vi
      .fn()
      .mockResolvedValue({ results: [], totalCount: 0 } satisfies SearchTransactionsResult),
    ...overrides,
  } as FakeReportQueryRepository;
}

function fakeSummary(id: string) {
  return {
    id,
    amount: '1000.00',
    currency: 'UZS',
    transactionType: 'EXPENSE' as const,
    categoryId: 'cat-1',
    merchant: 'Korzinka',
    transactionDate: new Date('2026-03-01'),
    description: 'test',
  };
}

describe('SearchTransactionsUseCase', () => {
  it('translates page 0 to offset 0 with the default page size (5)', async () => {
    const repo = fakeReportQueryRepository();
    const useCase = new SearchTransactionsUseCase(repo);

    await useCase.execute({ userId: USER_ID, filters: {}, dateRange: null, page: 0 });

    expect(repo.searchTransactions).toHaveBeenCalledWith(USER_ID, {}, null, {
      limit: 5,
      offset: 0,
    });
  });

  it('translates page 2 to offset 10', async () => {
    const repo = fakeReportQueryRepository();
    const useCase = new SearchTransactionsUseCase(repo);

    await useCase.execute({ userId: USER_ID, filters: {}, dateRange: null, page: 2 });

    expect(repo.searchTransactions).toHaveBeenCalledWith(USER_ID, {}, null, {
      limit: 5,
      offset: 10,
    });
  });

  it('clamps a negative page to 0, never a negative offset', async () => {
    const repo = fakeReportQueryRepository();
    const useCase = new SearchTransactionsUseCase(repo);

    await useCase.execute({ userId: USER_ID, filters: {}, dateRange: null, page: -3 });

    expect(repo.searchTransactions).toHaveBeenCalledWith(USER_ID, {}, null, {
      limit: 5,
      offset: 0,
    });
  });

  it('passes filters and dateRange through unchanged', async () => {
    const repo = fakeReportQueryRepository();
    const useCase = new SearchTransactionsUseCase(repo);
    const range = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

    await useCase.execute({
      userId: USER_ID,
      filters: { merchant: 'Korzinka', minAmount: '100.00' },
      dateRange: range,
      page: 0,
    });

    expect(repo.searchTransactions).toHaveBeenCalledWith(
      USER_ID,
      { merchant: 'Korzinka', minAmount: '100.00' },
      range,
      { limit: 5, offset: 0 },
    );
  });

  it('reports hasNextPage true when more rows exist beyond this page', async () => {
    const repo = fakeReportQueryRepository({
      searchTransactions: vi.fn().mockResolvedValue({
        results: [
          fakeSummary('a'),
          fakeSummary('b'),
          fakeSummary('c'),
          fakeSummary('d'),
          fakeSummary('e'),
        ],
        totalCount: 11,
      }),
    });
    const useCase = new SearchTransactionsUseCase(repo);

    const output = await useCase.execute({
      userId: USER_ID,
      filters: {},
      dateRange: null,
      page: 0,
    });

    expect(output.hasNextPage).toBe(true);
    expect(output.hasPreviousPage).toBe(false);
  });

  it('reports hasNextPage false on the last page (exact boundary)', async () => {
    const repo = fakeReportQueryRepository({
      searchTransactions: vi.fn().mockResolvedValue({
        results: [fakeSummary('k')],
        totalCount: 11,
      }),
    });
    const useCase = new SearchTransactionsUseCase(repo);

    const output = await useCase.execute({
      userId: USER_ID,
      filters: {},
      dateRange: null,
      page: 2,
    });

    expect(output.hasNextPage).toBe(false);
    expect(output.hasPreviousPage).toBe(true);
  });

  it('reports both false for a single-page result set (empty, page 0)', async () => {
    const repo = fakeReportQueryRepository();
    const useCase = new SearchTransactionsUseCase(repo);

    const output = await useCase.execute({
      userId: USER_ID,
      filters: {},
      dateRange: null,
      page: 0,
    });

    expect(output.results).toEqual([]);
    expect(output.totalCount).toBe(0);
    expect(output.hasNextPage).toBe(false);
    expect(output.hasPreviousPage).toBe(false);
  });
});

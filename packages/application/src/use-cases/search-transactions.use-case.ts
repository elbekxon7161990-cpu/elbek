import { Inject, Injectable } from '@nestjs/common';
import type {
  ReportDateRange,
  ReportQueryFilters,
  ReportQueryRepository,
  SearchResultSummary,
} from '@afa/domain';
import { REPORT_QUERY_REPOSITORY } from '@afa/domain';

/** FR-SCH-003 — "paginated (default 5 per page)". */
const PAGE_SIZE = 5;

export interface SearchTransactionsInput {
  userId: string;
  filters: ReportQueryFilters;
  /** `null` — an unbounded search, per FR-SCH-001's own "date range" being one independent, optional filter among several. */
  dateRange: ReportDateRange | null;
  /** Zero-based. Negative values are clamped to `0`, never producing a negative offset. */
  page: number;
}

export interface SearchTransactionsOutput {
  readonly results: readonly SearchResultSummary[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

/**
 * TASK-FIN-012 (Chapter 10 §10.3, FR-SCH-001/003/004) — `/search`'s
 * structured-filter use case. A thin composition over
 * `ReportQueryRepository.searchTransactions` (no financial calculation of
 * its own — READ ONLY): the only logic here is page-number-to-offset
 * translation and the has-next/has-previous derivation FR-SCH-003's
 * pagination needs, which the repository's own `totalCount` already makes
 * possible without a second round trip.
 */
@Injectable()
export class SearchTransactionsUseCase {
  constructor(
    @Inject(REPORT_QUERY_REPOSITORY) private readonly reportQueryRepository: ReportQueryRepository,
  ) {}

  async execute(input: SearchTransactionsInput): Promise<SearchTransactionsOutput> {
    const page = Math.max(0, input.page);
    const offset = page * PAGE_SIZE;

    const { results, totalCount } = await this.reportQueryRepository.searchTransactions(
      input.userId,
      input.filters,
      input.dateRange,
      { limit: PAGE_SIZE, offset },
    );

    return {
      results,
      totalCount,
      page,
      pageSize: PAGE_SIZE,
      hasNextPage: offset + results.length < totalCount,
      hasPreviousPage: page > 0,
    };
  }
}

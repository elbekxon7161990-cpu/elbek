import { Inject, Injectable } from '@nestjs/common';
import type {
  CashFlowTotals,
  CategoryAmount,
  MerchantAmount,
  ReportBucketGranularity,
  ReportDateRange,
  ReportPeriodBucket,
  ReportPeriodTotals,
  ReportQueryFilters,
  ReportQueryRepository,
  ReportTransactionSummary,
  SearchTransactionsResult,
  TransactionType,
} from '@afa/domain';
import { addDecimalAmounts } from '@afa/domain';
import { getCurrentUserId } from '@afa/shared';
import { Prisma } from '@prisma/client';

import { PRISMA_BASE_CLIENT } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { computeFullCashFlow } from './compute-full-cash-flow';
import { computeNetCashFlow } from './compute-net-cash-flow';
import { formatDecimalAmount } from './format-decimal-amount';

const INCOME_LIKE_TYPES: readonly TransactionType[] = ['INCOME', 'SALARY', 'REFUND'];

function buildWhere(
  userId: string,
  range: ReportDateRange,
  filters?: ReportQueryFilters,
): Prisma.TransactionWhereInput {
  return {
    userId,
    deletedAt: null,
    transactionDate: { gte: range.start, lt: range.end },
    ...(filters?.categoryId !== undefined && { categoryId: filters.categoryId }),
    ...(filters?.merchant !== undefined && { merchant: filters.merchant }),
    ...(filters?.transactionType !== undefined && { transactionType: filters.transactionType }),
  };
}

/**
 * TASK-FIN-012 — `searchTransactions`'s own WHERE builder, deliberately
 * separate from `buildWhere` above (never modified — every one of its
 * existing TASK-REP-001/REP-007 callers keeps its exact prior behavior).
 * Two differences from `buildWhere`: `range` is optional (a search may be
 * unbounded), and `merchant` is a case-insensitive substring match
 * (`contains`) rather than an exact match — matching FR-SCH-006's own ADR
 * ("simple LIKE/ILIKE pattern match", no dedicated full-text index).
 */
function buildSearchWhere(
  userId: string,
  range: ReportDateRange | null,
  filters: ReportQueryFilters,
): Prisma.TransactionWhereInput {
  return {
    userId,
    deletedAt: null,
    ...(range !== null && { transactionDate: { gte: range.start, lt: range.end } }),
    ...(filters.categoryId !== undefined && { categoryId: filters.categoryId }),
    ...(filters.merchant !== undefined && {
      merchant: { contains: filters.merchant, mode: 'insensitive' },
    }),
    ...(filters.transactionType !== undefined && { transactionType: filters.transactionType }),
    ...((filters.minAmount !== undefined || filters.maxAmount !== undefined) && {
      amount: {
        ...(filters.minAmount !== undefined && { gte: filters.minAmount }),
        ...(filters.maxAmount !== undefined && { lte: filters.maxAmount }),
      },
    }),
    ...(filters.tags !== undefined &&
      filters.tags.length > 0 && { tags: { hasSome: [...filters.tags] } }),
  };
}

interface PeriodicBreakdownRow {
  bucket_start: Date;
  total_expense: Prisma.Decimal | string | null;
  total_income: Prisma.Decimal | string | null;
}

/**
 * TASK-REP-007 (Chapter 9 §9.1.4/§9.5) — implements @afa/domain's
 * `ReportQueryRepository` port, following `PrismaExpenseHistoryRepository`'s
 * own precedent (TASK-FIN-001 Part 2): a dedicated repository over the same
 * `transactions` table, deterministic SQL aggregation only (`_sum`/`_avg`/
 * `groupBy`/raw `date_trunc`), never a value summed in application code
 * except the one documented exception below.
 *
 * Every method except `getPeriodicBreakdown` uses the normal RLS-extended
 * `this.prisma` client — `Transaction` is RLS-protected, and Prisma's
 * `groupBy`/`aggregate`/`findMany`/`count` all pass through the existing
 * `rls-user-context` extension transparently, the same as every other
 * read-only repository in this codebase.
 *
 * `getPeriodicBreakdown` is the one exception: `date_trunc('day'/'month',
 * transaction_date)` grouping has no Prisma ORM equivalent, so it requires
 * `$queryRaw`. Per `rls-context.extension.ts`'s own doc comment, `$queryRaw`
 * is a client-level operation the RLS extension never intercepts — issuing
 * it directly against `this.prisma` would silently run with NO RLS context
 * ever set on that connection. This is the exact same problem TASK-DB-010
 * solved for `PrismaTransactionRepository.create()`/`update()`/
 * `softDelete()`: inject `PRISMA_BASE_CLIENT` (the unextended client) as a
 * second dependency, and manually issue `SELECT set_config('app.
 * current_user_id', ...)` inside the same `basePrisma.$transaction(...)`
 * as the raw query itself — the identical, already-established pattern,
 * not a new one invented for this task.
 */
@Injectable()
export class PrismaReportQueryRepository implements ReportQueryRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRISMA_BASE_CLIENT) private readonly basePrisma: PrismaService,
  ) {}

  async getTotals(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<ReportPeriodTotals> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['transactionType'],
      where: buildWhere(userId, range, filters),
      _sum: { amount: true },
    });

    let totalExpense = '0.00';
    let totalIncome = '0.00';
    for (const row of rows) {
      const sum = formatDecimalAmount(row._sum.amount);
      if (row.transactionType === 'EXPENSE') {
        totalExpense = addDecimalAmounts(totalExpense, sum);
      } else if (INCOME_LIKE_TYPES.includes(row.transactionType as TransactionType)) {
        totalIncome = addDecimalAmounts(totalIncome, sum);
      }
    }

    return { totalExpense, totalIncome };
  }

  async getCategoryBreakdown(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<CategoryAmount[]> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: buildWhere(userId, range, filters),
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    return rows.map((row) => ({
      categoryId: row.categoryId,
      totalAmount: formatDecimalAmount(row._sum.amount),
    }));
  }

  async getMerchantBreakdown(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<MerchantAmount[]> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['merchant'],
      where: { ...buildWhere(userId, range, filters), merchant: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    return rows
      .filter((row): row is typeof row & { merchant: string } => row.merchant !== null)
      .map((row) => ({
        merchant: row.merchant,
        totalAmount: formatDecimalAmount(row._sum.amount),
        transactionCount: row._count._all,
      }));
  }

  async getPeriodicBreakdown(
    userId: string,
    range: ReportDateRange,
    granularity: ReportBucketGranularity,
    filters?: ReportQueryFilters,
  ): Promise<ReportPeriodBucket[]> {
    const requestUserId = getCurrentUserId();

    const conditions: Prisma.Sql[] = [
      Prisma.sql`user_id = ${userId}::uuid`,
      Prisma.sql`deleted_at IS NULL`,
      Prisma.sql`transaction_date >= ${range.start}`,
      Prisma.sql`transaction_date < ${range.end}`,
    ];
    if (filters?.categoryId !== undefined) {
      conditions.push(Prisma.sql`category_id = ${filters.categoryId}::uuid`);
    }
    if (filters?.merchant !== undefined) {
      conditions.push(Prisma.sql`merchant = ${filters.merchant}`);
    }
    if (filters?.transactionType !== undefined) {
      conditions.push(Prisma.sql`transaction_type = ${filters.transactionType}`);
    }
    const whereClause = Prisma.join(conditions, ' AND ');

    const rows = await this.basePrisma.$transaction(async (tx) => {
      if (requestUserId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${requestUserId}, true)`;
      }
      return tx.$queryRaw<PeriodicBreakdownRow[]>`
        SELECT date_trunc(${granularity}, transaction_date) AS bucket_start,
               COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'EXPENSE'), 0) AS total_expense,
               COALESCE(SUM(amount) FILTER (WHERE transaction_type IN ('INCOME', 'SALARY', 'REFUND')), 0) AS total_income
        FROM transactions
        WHERE ${whereClause}
        GROUP BY bucket_start
        ORDER BY bucket_start ASC
      `;
    });

    return rows.map((row) => ({
      bucketStart: row.bucket_start,
      totalExpense: formatDecimalAmount(row.total_expense),
      totalIncome: formatDecimalAmount(row.total_income),
    }));
  }

  async getLargestTransactions(
    userId: string,
    range: ReportDateRange,
    filters: ReportQueryFilters,
    limit: number,
  ): Promise<ReportTransactionSummary[]> {
    const rows = await this.prisma.transaction.findMany({
      where: buildWhere(userId, range, filters),
      orderBy: { amount: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      amount: formatDecimalAmount(row.amount),
      transactionType: row.transactionType as TransactionType,
      categoryId: row.categoryId,
      merchant: row.merchant,
      transactionDate: row.transactionDate,
      description: row.description,
    }));
  }

  async getTransactionCount(
    userId: string,
    range: ReportDateRange,
    filters?: ReportQueryFilters,
  ): Promise<number> {
    return this.prisma.transaction.count({ where: buildWhere(userId, range, filters) });
  }

  async getEarliestTransactionDate(userId: string): Promise<Date | null> {
    const row = await this.prisma.transaction.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true },
    });
    return row?.transactionDate ?? null;
  }

  /**
   * TASK-REP-001 (remaining scope) — delegates directly to TASK-FIN-008's
   * own `computeNetCashFlow`/`computeFullCashFlow` (FR-FIN-031: never a
   * second implementation of either formula). `computeFullCashFlow` is only
   * called when `includeFullCashFlow` is true, avoiding its extra
   * debt/transfer queries on the common (standard-view) path.
   *
   * Boundary conversion: `ReportDateRange.end` is EXCLUSIVE (this file's
   * own `buildWhere`/`getPeriodicBreakdown` both use `lt: range.end`), but
   * `computeNetCashFlow`/`computeFullCashFlow`'s own `periodEnd` is
   * INCLUSIVE (`BETWEEN periodStart AND periodEnd`, per their own existing
   * integration-test convention of passing a period's last calendar day
   * directly). Subtracting 1ms converts exclusive-end to inclusive-end
   * without altering either formula's own contract.
   */
  async getCashFlow(
    userId: string,
    range: ReportDateRange,
    defaultCurrency: string,
    includeFullCashFlow: boolean,
  ): Promise<CashFlowTotals> {
    const scope = {
      userId,
      defaultCurrency,
      periodStart: range.start,
      periodEnd: new Date(range.end.getTime() - 1),
    };

    if (!includeFullCashFlow) {
      const netCashFlow = await computeNetCashFlow(this.prisma, scope);
      return { netCashFlow, fullCashFlow: null };
    }

    const [netCashFlow, fullCashFlow] = await Promise.all([
      computeNetCashFlow(this.prisma, scope),
      computeFullCashFlow(this.prisma, scope),
    ]);
    return { netCashFlow, fullCashFlow };
  }

  async searchTransactions(
    userId: string,
    filters: ReportQueryFilters,
    range: ReportDateRange | null,
    pagination: { readonly limit: number; readonly offset: number },
  ): Promise<SearchTransactionsResult> {
    const where = buildSearchWhere(userId, range, filters);
    const [rows, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        skip: pagination.offset,
        take: pagination.limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      results: rows.map((row) => ({
        id: row.id,
        amount: formatDecimalAmount(row.amount),
        currency: row.currency,
        transactionType: row.transactionType as TransactionType,
        categoryId: row.categoryId,
        merchant: row.merchant,
        transactionDate: row.transactionDate,
        description: row.description,
      })),
      totalCount,
    };
  }
}

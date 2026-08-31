import { Injectable } from '@nestjs/common';
import type {
  ExportQueryFilters,
  ExportQueryRepository,
  ExportTransactionRow,
  ReportDateRange,
  TransactionType,
} from '@afa/domain';
import { multiplyDecimalAmounts, roundDecimalAmountToScale } from '@afa/domain';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { formatDecimalAmount } from './format-decimal-amount';

/**
 * TASK-FIN-014 (Chapter 10 §10.2, FR-EXP2-001/002/007). Own, dedicated
 * repository over the same `transactions` table `PrismaReportQueryRepository`
 * already reads — never modifies that file, never adds an export-shaped
 * method to its interface (see `ExportQueryRepository`'s own doc comment
 * for why).
 *
 * `Transaction` is RLS-protected — the normal RLS-extended `this.prisma`
 * client is all that's needed here (a plain `findMany`, no `date_trunc`-
 * style raw SQL), same as every other Prisma ORM read in this codebase.
 *
 * BR-EXP2-002 — soft-deleted transactions excluded by default (`deletedAt:
 * null`); this task does not implement the optional "include deleted"
 * full-fidelity-backup variant BR-EXP2-002 also describes (disclosed scope
 * simplification, see this task's final report).
 */
function buildWhere(
  userId: string,
  range: ReportDateRange,
  filters: ExportQueryFilters,
): Prisma.TransactionWhereInput {
  return {
    userId,
    deletedAt: null,
    transactionDate: { gte: range.start, lt: range.end },
    ...(filters.categoryId !== undefined && { categoryId: filters.categoryId }),
    ...(filters.transactionType !== undefined && { transactionType: filters.transactionType }),
  };
}

/** TASK-FIN-014's own Definition of Done — "original-currency amount and converted-default-currency equivalent as separate columns." `exchangeRateToDefault` is the transaction's OWN stored snapshot (BR-INC-002/FR-REP-021 — never a fresh lookup, never a single "today's rate" applied retroactively); `null` when no snapshot was ever recorded (the transaction's own currency already matched the account's default at the time), which correctly yields `convertedAmount: null` rather than a fabricated 1:1 conversion. */
function computeConvertedAmount(
  amount: string,
  exchangeRateToDefault: string | null,
): string | null {
  if (exchangeRateToDefault === null) {
    return null;
  }
  return roundDecimalAmountToScale(multiplyDecimalAmounts(amount, exchangeRateToDefault), 2);
}

@Injectable()
export class PrismaExportQueryRepository implements ExportQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getTransactionRows(
    userId: string,
    range: ReportDateRange,
    filters: ExportQueryFilters,
    limit: number,
  ): Promise<ExportTransactionRow[]> {
    const rows = await this.prisma.transaction.findMany({
      where: buildWhere(userId, range, filters),
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        transactionDate: true,
        transactionType: true,
        amount: true,
        currency: true,
        exchangeRateToDefault: true,
        merchant: true,
        paymentMethod: true,
        tags: true,
        description: true,
        category: { select: { code: true } },
      },
    });

    return rows.map((row) => {
      const amount = formatDecimalAmount(row.amount);
      // `exchangeRateToDefault` is `Decimal(18,8)` — a RATE, not money.
      // Never run it through `formatDecimalAmount` (that function is
      // money-only and would force it to 2 decimals, truncating real
      // precision — the exact bug `format-decimal-amount.ts`'s own doc
      // comment records already having been fixed once for `FxRate.rate`).
      // Bare `.toString()` matches `prisma-fx-rate.repository.ts`'s own
      // documented convention for this same column type.
      const exchangeRateToDefault =
        row.exchangeRateToDefault === null ? null : row.exchangeRateToDefault.toString();
      return {
        id: row.id,
        transactionDate: row.transactionDate,
        transactionType: row.transactionType as TransactionType,
        amount,
        currency: row.currency,
        convertedAmount: computeConvertedAmount(amount, exchangeRateToDefault),
        categoryCode: row.category?.code ?? null,
        merchant: row.merchant,
        paymentMethod: row.paymentMethod,
        tags: row.tags,
        description: row.description,
      };
    });
  }
}

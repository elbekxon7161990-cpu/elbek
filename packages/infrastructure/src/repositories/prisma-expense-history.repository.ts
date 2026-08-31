import { Injectable } from '@nestjs/common';
import type { ExpenseHistoryRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

const TRAILING_WINDOW_DAYS = 90;

/**
 * TASK-FIN-001 (FR-EXP-004) — the trailing-90-day average EXPENSE amount,
 * same-currency only, soft-deleted rows excluded (see the domain port's own
 * doc comment for the full reasoning behind each of these choices).
 *
 * Uses Prisma's `aggregate({ _avg })`, which computes `AVG()` in PostgreSQL
 * itself and returns a `Prisma.Decimal` — the average is never computed by
 * summing/dividing in application code, so no value here ever passes
 * through a JS `number` (DB-P3/FR-DB-027).
 */
@Injectable()
export class PrismaExpenseHistoryRepository implements ExpenseHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getTrailingAverageExpenseAmount(
    userId: string,
    currency: string,
    asOf: Date,
  ): Promise<string | null> {
    const windowStart = new Date(asOf);
    windowStart.setUTCDate(windowStart.getUTCDate() - TRAILING_WINDOW_DAYS);

    const result = await this.prisma.transaction.aggregate({
      where: {
        userId,
        currency,
        transactionType: 'EXPENSE',
        deletedAt: null,
        transactionDate: { gte: windowStart, lt: asOf },
      },
      _avg: { amount: true },
    });

    return result._avg.amount ? result._avg.amount.toString() : null;
  }
}

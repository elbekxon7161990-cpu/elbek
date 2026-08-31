import { Injectable } from '@nestjs/common';
import type { FxRateLookupResult, FxRateRepository, NewFxRateData } from '@afa/domain';
import { validateNewFxRateData } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

function toCalendarDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * TASK-FIN-007 (Stage C) — implements @afa/domain's `FxRateRepository` port
 * against the `fx_rates` table (§13.8). NOT RLS-protected
 * (`rls-protected-models.ts` explicitly lists `FxRate` under "deliberately
 * NOT included" — pure global reference data, never user-owned), so unlike
 * every other repository this task session has built, no `runWithUserContext`
 * wrapping is needed anywhere in this file.
 */
@Injectable()
export class PrismaFxRateRepository implements FxRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * FR-FIN-029 — "the most recent available rate PRIOR to that date."
   * `asOfDate` is a calendar-date-only column (§13.8, no time component);
   * `requestedDate` is compared at the same calendar-date granularity
   * (`toCalendarDateOnly`), the same convention `classifyDebtReminderCondition`
   * already established for a different calendar-date-only column
   * (`debts.due_date`).
   */
  async findRate(
    baseCurrency: string,
    quoteCurrency: string,
    requestedDate: Date,
  ): Promise<FxRateLookupResult | null> {
    const row = await this.prisma.fxRate.findFirst({
      where: { baseCurrency, quoteCurrency, asOfDate: { lte: requestedDate } },
      orderBy: { asOfDate: 'desc' },
    });
    if (!row) {
      return null;
    }
    const isApproximate = toCalendarDateOnly(row.asOfDate) !== toCalendarDateOnly(requestedDate);
    return {
      // TASK-FIN-008 (precision bug fix) — `rate` is `Decimal(18,8)`, not a
      // 2-decimal money amount; `formatDecimalAmount` was previously (and
      // incorrectly) applied here, silently truncating real rate precision
      // (e.g. "0.123456789" -> "0.12") and persisting the truncated value
      // wherever this result flows into `transactions.exchange_rate_to_default`.
      // Bare `Decimal#toString()` is the established, correct convention for
      // this class of field — the same treatment `loan.mapper.ts` already
      // gives `Loan.interestRate` (also a rate, also deliberately excluded
      // from `formatDecimalAmount`, per that function's own doc comment).
      rate: row.rate.toString(),
      asOfDate: row.asOfDate,
      isApproximate,
    };
  }

  /**
   * FR-INT-003 — idempotent upsert, safe to call repeatedly with the same
   * `(baseCurrency, quoteCurrency, asOfDate)` (e.g. a retried ingestion
   * job) — `fx_rates`'s own `@@unique([baseCurrency, quoteCurrency,
   * asOfDate])` IS a real, Prisma-declared compound unique key (unlike
   * `Budget`'s/`Account`'s own partial-index constraints), so `upsert()`
   * is directly usable here with no P2002-catch-and-reread needed.
   */
  async recordRate(data: NewFxRateData): Promise<void> {
    validateNewFxRateData(data);

    await this.prisma.fxRate.upsert({
      where: {
        baseCurrency_quoteCurrency_asOfDate: {
          baseCurrency: data.baseCurrency,
          quoteCurrency: data.quoteCurrency,
          asOfDate: data.asOfDate,
        },
      },
      create: {
        baseCurrency: data.baseCurrency,
        quoteCurrency: data.quoteCurrency,
        rate: data.rate,
        asOfDate: data.asOfDate,
        source: data.source ?? null,
      },
      update: {
        rate: data.rate,
        source: data.source ?? null,
      },
    });
  }
}

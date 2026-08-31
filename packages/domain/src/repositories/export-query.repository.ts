import type { ReportDateRange } from '../reports/report-query-types';
import type { TransactionType } from '../entities/transaction.entity';

export const EXPORT_QUERY_REPOSITORY = Symbol('EXPORT_QUERY_REPOSITORY');

/**
 * TASK-FIN-014 (Chapter 10 §10.2, FR-EXP2-001/002/007). A dedicated,
 * purpose-scoped repository over the same `transactions` table
 * `ReportQueryRepository` already reads — not an addition to that
 * interface, since export needs the FULL row shape (payment method, tags,
 * a resolved category code, a converted-currency amount) that report's own
 * general aggregation primitives were never meant to carry, mirroring
 * `ReportQueryRepository`'s own doc comment's reasoning for why it exists
 * as ITS OWN dedicated repository rather than new methods bolted onto
 * `TransactionRepository`.
 */
export interface ExportQueryFilters {
  readonly categoryId?: string;
  readonly transactionType?: TransactionType;
}

/**
 * FR-EXP2-007 (P0) — "resolved category/account names, not raw FK UUIDs."
 * `categoryCode` is the stable taxonomy code (e.g. `'FOOD_DINING'`), the
 * same value `CategoryReference.code` now exposes — not a localized display
 * name (full category translation modeling is TASK-FIN-006's own deferred
 * scope), `null` only for the data-integrity edge case of a since-deleted
 * category row.
 *
 * `convertedAmount`/`exchangeRateToDefault` satisfy TASK-FIN-014's own
 * Definition of Done ("original-currency amount and converted-default-
 * currency equivalent as separate columns") — `exchangeRateToDefault` is
 * the transaction's OWN stored snapshot (BR-INC-002/FR-REP-021's "never a
 * single today's-rate applied retroactively" principle), never a fresh
 * lookup; `convertedAmount` is `null` only when that snapshot itself is
 * `null` (a transaction whose currency already equals the account's
 * default at the time it was recorded, per `TransactionRepository`'s own
 * convention — never a fabricated 1:1 rate).
 */
export interface ExportTransactionRow {
  readonly id: string;
  readonly transactionDate: Date;
  readonly transactionType: TransactionType;
  readonly amount: string;
  readonly currency: string;
  readonly convertedAmount: string | null;
  readonly categoryCode: string | null;
  readonly merchant: string | null;
  readonly paymentMethod: string | null;
  readonly tags: readonly string[];
  readonly description: string;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary). Implemented by
 * @afa/infrastructure; @afa/application depends only on this interface.
 *
 * No pagination parameter — `ExportTransactionsUseCase` (TASK-FIN-014's own
 * scope decision: synchronous delivery only, see this task's final report)
 * enforces a single fixed row cap via `limit`, requesting `limit + 1` rows
 * from the implementation so the use case can distinguish "fits" from
 * "exceeds the cap" without a separate `COUNT(*)` query.
 */
export interface ExportQueryRepository {
  getTransactionRows(
    userId: string,
    range: ReportDateRange,
    filters: ExportQueryFilters,
    limit: number,
  ): Promise<ExportTransactionRow[]>;
}

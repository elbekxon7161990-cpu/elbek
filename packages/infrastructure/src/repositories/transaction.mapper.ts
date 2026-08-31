import type {
  PaymentMethod,
  TransactionConfidenceScores,
  TransactionCreatedBy,
  TransactionSourceType,
  TransactionType,
} from '@afa/domain';
import { Transaction } from '@afa/domain';
import type { Transaction as PrismaTransactionRow } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/**
 * `@db.Time(6)` round-trips through Prisma as a `Date` whose date component
 * is a fixed epoch value — only the UTC time-of-day portion is meaningful.
 * Read with UTC getters (never `toISOString().slice(...)`, which is
 * locale-safe but still worth being explicit about) to avoid any ambiguity.
 */
export function formatTransactionTime(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/** Inverse of `formatTransactionTime` — for writing a domain "HH:MM:SS" string back to a `@db.Time(6)` column. */
export function parseTransactionTime(value: string): Date {
  return new Date(`1970-01-01T${value}Z`);
}

/**
 * Prisma row → domain `Transaction`. Re-validates through the domain
 * constructor (defense-in-depth — a row that somehow violates an invariant
 * surfaces loudly here rather than being trusted silently).
 *
 * `amount`/`exchangeRateToDefault` are Prisma `Decimal` (arbitrary-precision,
 * backed by decimal.js) — never `Number()`/`parseFloat`, so no value is ever
 * routed through IEEE-754 float (DB-P3/FR-DB-027).
 *
 * TASK-FIN-007 (Stage E) — `amount` previously used `Decimal#toString()`
 * directly, which trims trailing zeros (`"12000.00"` -> `"12000"`,
 * `format-decimal-amount.ts`'s own doc comment) — a real, pre-existing bug
 * for a money field, exposed by this stage's own tests. Now uses
 * `formatDecimalAmount` (2-decimal canonical), the same fix already applied
 * to every other money mapper in this package. `exchangeRateToDefault`
 * deliberately keeps plain `Decimal#toString()` — it is `Decimal(18,8)`,
 * not a 2-decimal money field, and `formatDecimalAmount` would truncate a
 * genuinely high-precision rate; `toString()`'s trailing-zero trimming
 * loses no significant digits, only a cosmetic difference (`"12000"` vs
 * `"12000.00"`), and no requirement anywhere calls for a fixed decimal-place
 * count on a rate.
 *
 * `transactionType`/`paymentMethod`/`sourceType`/`createdBy` are plain
 * `string` columns at the Prisma level (Chapter 13 §13.23's "TEXT + CHECK,
 * never native enum" rule) — the casts below are safe because the database
 * CHECK constraints are the actual source of truth for validity; the domain
 * constructor's own runtime check is the second, independent line of
 * defense if that assumption is ever wrong.
 *
 * TASK-FIN-004 (Stage B) — `sourceAccountId`/`destinationAccountId`/`goalId`
 * are plain nullable UUID passthroughs, same treatment as `accountId`.
 * `destinationAmount` is a `Decimal(18,2)` money field, so it gets the same
 * `formatDecimalAmount` treatment as `amount` (not `exchangeRateToDefault`'s
 * raw `.toString()` — see that field's own comment above for why the two
 * money-shaped-vs-rate-shaped fields are handled differently).
 */
export function toDomainTransaction(row: PrismaTransactionRow): Transaction {
  return new Transaction({
    id: row.id,
    userId: row.userId,
    transactionType: row.transactionType as TransactionType,
    amount: formatDecimalAmount(row.amount),
    currency: row.currency,
    exchangeRateToDefault: row.exchangeRateToDefault ? row.exchangeRateToDefault.toString() : null,
    accountId: row.accountId,
    sourceAccountId: row.sourceAccountId,
    destinationAccountId: row.destinationAccountId,
    destinationAmount: row.destinationAmount ? formatDecimalAmount(row.destinationAmount) : null,
    goalId: row.goalId,
    categoryId: row.categoryId,
    subcategoryId: row.subcategoryId,
    merchant: row.merchant,
    paymentMethod: row.paymentMethod as PaymentMethod | null,
    transactionDate: row.transactionDate,
    transactionTime: row.transactionTime ? formatTransactionTime(row.transactionTime) : null,
    location: row.location,
    tags: row.tags,
    description: row.description,
    originalText: row.originalText,
    sourceType: row.sourceType as TransactionSourceType,
    sourceReference: row.sourceReference,
    confidenceScores: row.confidenceScores as TransactionConfidenceScores | null,
    isRecurringDetected: row.isRecurringDetected,
    linkedTransactionId: row.linkedTransactionId,
    createdBy: row.createdBy as TransactionCreatedBy,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

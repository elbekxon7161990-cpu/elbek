import type { DebtDirection, DebtStatus } from '@afa/domain';
import { Counterparty, Debt, DebtRepayment } from '@afa/domain';
import type {
  Counterparty as PrismaCounterpartyRow,
  Debt as PrismaDebtRow,
  DebtRepayment as PrismaDebtRepaymentRow,
} from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/**
 * Prisma row -> domain entity, re-validating through each domain
 * constructor (defense-in-depth, the same convention `transaction.mapper.ts`
 * established). Amounts go through `formatDecimalAmount`, never a bare
 * `.toString()` — `Prisma.Decimal#toString()` trims trailing zeros
 * (`"75000.00"` -> `"75000"`), which would silently violate this schema's
 * canonical `Decimal(18,2)` string shape (confirmed empirically against
 * real Postgres while building this task's own integration tests, the same
 * bug TASK-REP-007 first found and fixed). No value here ever passes
 * through `Number()`/`parseFloat` (DB-P3/FR-DB-027).
 */
export function toDomainDebt(row: PrismaDebtRow): Debt {
  return new Debt({
    id: row.id,
    userId: row.userId,
    direction: row.direction as DebtDirection,
    counterpartyName: row.counterpartyName,
    counterpartyRefId: row.counterpartyRefId,
    originalAmount: formatDecimalAmount(row.originalAmount),
    outstandingBalance: formatDecimalAmount(row.outstandingBalance),
    currency: row.currency,
    transactionDate: row.transactionDate,
    dueDate: row.dueDate,
    status: row.status as DebtStatus,
    notes: row.notes,
    originalText: row.originalText,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toDomainDebtRepayment(row: PrismaDebtRepaymentRow): DebtRepayment {
  return new DebtRepayment({
    id: row.id,
    debtId: row.debtId,
    amount: formatDecimalAmount(row.amount),
    currency: row.currency,
    repaymentDate: row.repaymentDate,
    originalText: row.originalText,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  });
}

export function toDomainCounterparty(row: PrismaCounterpartyRow): Counterparty {
  return new Counterparty({
    id: row.id,
    userId: row.userId,
    name: row.name,
    aliases: row.aliases,
    createdAt: row.createdAt,
  });
}

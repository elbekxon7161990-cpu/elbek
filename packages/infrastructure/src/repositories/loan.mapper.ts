import type { LoanInstallmentFrequency, LoanStatus } from '@afa/domain';
import { Loan } from '@afa/domain';
import type { Loan as PrismaLoanRow } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/**
 * Prisma row -> domain `Loan`, re-validating through the domain constructor
 * (defense-in-depth, the same convention `debt.mapper.ts`/`transaction.mapper.ts`
 * already establish). `principalAmount`/`outstandingBalance`/`installmentAmount`
 * are `Decimal(18,2)` money fields, so they get `formatDecimalAmount`.
 * `interestRate` (`Decimal(6,4)`) deliberately does NOT — same treatment as
 * `Transaction.exchangeRateToDefault`/`FxRate.rate`: `formatDecimalAmount`
 * would truncate a genuinely-4-decimal-precision rate to 2 (silent precision
 * loss, actively wrong for a rate field), and no PRD/schema requirement
 * demands a fixed decimal-place count for it — raw `Decimal#toString()`'s
 * trailing-zero-trimmed-but-never-significant-digit-losing output is used
 * instead, mirroring `format-decimal-amount.ts`'s own documented boundary.
 */
export function toDomainLoan(row: PrismaLoanRow): Loan {
  return new Loan({
    id: row.id,
    userId: row.userId,
    lender: row.lender,
    principalAmount: formatDecimalAmount(row.principalAmount),
    outstandingBalance: formatDecimalAmount(row.outstandingBalance),
    currency: row.currency,
    interestRate: row.interestRate ? row.interestRate.toString() : null,
    installmentAmount: formatDecimalAmount(row.installmentAmount),
    installmentFrequency: row.installmentFrequency as LoanInstallmentFrequency,
    startDate: row.startDate,
    status: row.status as LoanStatus,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

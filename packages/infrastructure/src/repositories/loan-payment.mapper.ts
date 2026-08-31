import { LoanPayment } from '@afa/domain';
import type { LoanPayment as PrismaLoanPaymentRow } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/**
 * Prisma row -> domain `LoanPayment`, re-validating through the domain
 * constructor (defense-in-depth, same convention as every other mapper in
 * this package). Both `amount` and `principalPortion` are `Decimal(18,2)`
 * money fields, so both get `formatDecimalAmount` — unlike `Loan.interestRate`
 * (`Decimal(6,4)`, deliberately raw `.toString()` in `loan.mapper.ts`),
 * there is no wider-precision field here to preserve.
 */
export function toDomainLoanPayment(row: PrismaLoanPaymentRow): LoanPayment {
  return new LoanPayment({
    id: row.id,
    loanId: row.loanId,
    amount: formatDecimalAmount(row.amount),
    principalPortion: formatDecimalAmount(row.principalPortion),
    paymentDate: row.paymentDate,
    createdAt: row.createdAt,
  });
}

import { Module } from '@nestjs/common';

import { CreateLoanUseCase } from '../use-cases/create-loan.use-case';
import { ListOpenLoansUseCase } from '../use-cases/list-open-loans.use-case';
import { LogLoanPaymentUseCase } from '../use-cases/log-loan-payment.use-case';

/**
 * TASK-FIN-004 Stage C/F (Chapter 8 §8.8) — Loan use cases: creation,
 * listing, and (Stage F) payment logging. Same repository-binding split as
 * `AccountModule`/`TransferModule`.
 */
@Module({
  providers: [CreateLoanUseCase, ListOpenLoansUseCase, LogLoanPaymentUseCase],
  exports: [CreateLoanUseCase, ListOpenLoansUseCase, LogLoanPaymentUseCase],
})
export class LoanModule {}

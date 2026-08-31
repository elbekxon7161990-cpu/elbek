import { Module } from '@nestjs/common';

import { CreateDebtUseCase } from '../use-cases/create-debt.use-case';
import { ListOpenDebtsUseCase } from '../use-cases/list-open-debts.use-case';
import { LogDebtRepaymentUseCase } from '../use-cases/log-debt-repayment.use-case';
import { SettleDebtUseCase } from '../use-cases/settle-debt.use-case';

/**
 * TASK-FIN-002 (Chapter 8 §8.3) — Debt Management use cases. Does not bind
 * USER_REPOSITORY/CURRENCY_REPOSITORY/COUNTERPARTY_REPOSITORY/
 * DEBT_REPOSITORY — same split as `FinanceModule`: binding those domain
 * ports to their infrastructure implementations is the composition root's
 * job, imported alongside this module by whichever apps/* app needs it.
 */
@Module({
  providers: [CreateDebtUseCase, LogDebtRepaymentUseCase, SettleDebtUseCase, ListOpenDebtsUseCase],
  exports: [CreateDebtUseCase, LogDebtRepaymentUseCase, SettleDebtUseCase, ListOpenDebtsUseCase],
})
export class DebtModule {}

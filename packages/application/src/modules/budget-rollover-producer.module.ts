import { Module } from '@nestjs/common';

import { RolloverBudgetPeriodsUseCase } from '../use-cases/rollover-budget-periods.use-case';

/**
 * TASK-FIN-003 — Budget-rollover producer only, mirroring
 * `DebtReminderProducerModule`'s own shape exactly: `apps/worker`'s
 * `BudgetRolloverModule` needs only `RolloverBudgetPeriodsUseCase`, not
 * `BudgetModule`'s CRUD use cases (`CreateBudgetUseCase`/`EditBudgetUseCase`/
 * `DeleteBudgetUseCase`/`ListBudgetsUseCase`), which pull in
 * `CATEGORY_REPOSITORY`/`USER_REPOSITORY`/`CURRENCY_REPOSITORY` — bindings
 * `apps/worker`'s composition root never provides (confirmed pre-existing
 * boot blocker: importing `BudgetModule` whole there fails NestJS DI
 * resolution). Does not bind `BUDGET_REPOSITORY` — the composition root's
 * job, same split as every other module in this package.
 */
@Module({
  providers: [RolloverBudgetPeriodsUseCase],
  exports: [RolloverBudgetPeriodsUseCase],
})
export class BudgetRolloverProducerModule {}

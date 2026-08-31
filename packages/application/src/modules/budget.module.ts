import { Module } from '@nestjs/common';

import { CreateBudgetUseCase } from '../use-cases/create-budget.use-case';
import { DeleteBudgetUseCase } from '../use-cases/delete-budget.use-case';
import { EditBudgetUseCase } from '../use-cases/edit-budget.use-case';
import { ListBudgetsUseCase } from '../use-cases/list-budgets.use-case';
import { RolloverBudgetPeriodsUseCase } from '../use-cases/rollover-budget-periods.use-case';

/**
 * TASK-FIN-003 (Chapter 8 §8.4) — Budget System use cases. Does not bind
 * USER_REPOSITORY/CURRENCY_REPOSITORY/CATEGORY_REPOSITORY/BUDGET_REPOSITORY
 * — same split as `DebtModule`: binding those domain ports to their
 * infrastructure implementations is the composition root's job, imported
 * alongside this module by whichever apps/* app needs it.
 */
@Module({
  providers: [
    CreateBudgetUseCase,
    EditBudgetUseCase,
    DeleteBudgetUseCase,
    ListBudgetsUseCase,
    RolloverBudgetPeriodsUseCase,
  ],
  exports: [
    CreateBudgetUseCase,
    EditBudgetUseCase,
    DeleteBudgetUseCase,
    ListBudgetsUseCase,
    RolloverBudgetPeriodsUseCase,
  ],
})
export class BudgetModule {}

import { Module } from '@nestjs/common';

import { CreateExpenseUseCase } from '../use-cases/create-expense.use-case';
import { CreateIncomeUseCase } from '../use-cases/create-income.use-case';
import { DeleteTransactionUseCase } from '../use-cases/delete-transaction.use-case';
import { EditTransactionUseCase } from '../use-cases/edit-transaction.use-case';
import { RestoreTransactionUseCase } from '../use-cases/restore-transaction.use-case';
import { UndoLastTransactionActionUseCase } from '../use-cases/undo-last-transaction-action.use-case';

/**
 * TASK-FIN-001 Part 2 — Expense & Income Management use cases. Does not bind
 * USER_REPOSITORY/TRANSACTION_REPOSITORY/CURRENCY_REPOSITORY/
 * CATEGORY_REPOSITORY/TRANSACTION_AUDIT_LOG_REPOSITORY — same as
 * AuthModule's UserRepositoryModule split, binding those domain ports to
 * their infrastructure implementations is the composition root's job (a
 * later part), imported alongside this module by whichever apps/* app needs it.
 */
@Module({
  providers: [
    CreateExpenseUseCase,
    CreateIncomeUseCase,
    EditTransactionUseCase,
    DeleteTransactionUseCase,
    RestoreTransactionUseCase,
    UndoLastTransactionActionUseCase,
  ],
  exports: [
    CreateExpenseUseCase,
    CreateIncomeUseCase,
    EditTransactionUseCase,
    DeleteTransactionUseCase,
    RestoreTransactionUseCase,
    UndoLastTransactionActionUseCase,
  ],
})
export class FinanceModule {}

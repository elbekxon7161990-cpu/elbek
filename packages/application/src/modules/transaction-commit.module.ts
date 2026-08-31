import { Module } from '@nestjs/common';

import { FinanceModule } from './finance.module';
import { TransactionCommitAdapter } from '../use-cases/transaction-commit.adapter';

/**
 * TASK-FIN-REAL-001 — provides `TransactionCommitAdapter` (the real
 * `TransactionCommitPort` implementation, reusing FinanceModule's
 * CreateExpenseUseCase/CreateIncomeUseCase from TASK-FIN-001 unchanged) as
 * a plain class, deliberately NOT bound to `@afa/domain`'s
 * `TRANSACTION_COMMIT_PORT` token here — whether to actually use this real
 * adapter or an explicit-opt-in fake is a composition-root decision (real
 * vs. fake vs. fail-fast, mirroring `LlmProviderModule`'s own split), which
 * only an app's own bootstrap can make. Does not bind `CATEGORY_REPOSITORY`
 * or `COMMIT_IDEMPOTENCY_LOCK` either — both domain ports this adapter
 * itself depends on — same composition-root split as every other module.
 */
@Module({
  imports: [FinanceModule],
  providers: [TransactionCommitAdapter],
  exports: [TransactionCommitAdapter],
})
export class TransactionCommitModule {}

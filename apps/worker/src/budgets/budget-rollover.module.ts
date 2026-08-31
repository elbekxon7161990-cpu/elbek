import { Module } from '@nestjs/common';
import { BudgetRolloverProducerModule } from '@afa/application';
import { BudgetRepositoryModule, BudgetRolloverQueueModule } from '@afa/infrastructure';

import { BudgetRolloverProcessor } from './budget-rollover.processor';
import { BudgetRolloverScheduler } from './budget-rollover.scheduler';

/**
 * TASK-FIN-003 — composition-root wiring, mirroring `DebtRemindersModule`'s
 * own shape exactly: imports `BudgetRolloverProducerModule` (only
 * `RolloverBudgetPeriodsUseCase`), not `BudgetModule` whole.
 *
 * Corrected pre-existing boot blocker (discovered by `ocr-di.integration.spec.ts`,
 * confirmed independently in the production-deployment-readiness audit):
 * `BudgetModule` also carries `CreateBudgetUseCase`/`EditBudgetUseCase`/
 * `DeleteBudgetUseCase`/`ListBudgetsUseCase`, which NestJS eagerly
 * instantiates alongside `RolloverBudgetPeriodsUseCase` the moment the whole
 * module is imported — `CreateBudgetUseCase`/`EditBudgetUseCase` need
 * `CATEGORY_REPOSITORY`/`USER_REPOSITORY`/`CURRENCY_REPOSITORY`, none of
 * which `apps/worker`'s composition root binds anywhere, so the app's full
 * `AppModule` failed to boot. `BudgetModule` itself is untouched (still used
 * as-is by `apps/telegram-bot`'s `/budget` flow, which already binds all
 * four repositories itself) — `BudgetRolloverProducerModule` mirrors
 * `DebtReminderProducerModule`'s existing narrow-producer-module precedent
 * instead of duplicating it ad hoc.
 */
@Module({
  imports: [BudgetRolloverProducerModule, BudgetRepositoryModule, BudgetRolloverQueueModule],
  providers: [BudgetRolloverProcessor, BudgetRolloverScheduler],
})
export class BudgetRolloverModule {}

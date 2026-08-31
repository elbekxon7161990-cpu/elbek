import { Module } from '@nestjs/common';

import { ContributeToSavingsGoalUseCase } from '../use-cases/contribute-to-savings-goal.use-case';
import { CreateSavingsGoalUseCase } from '../use-cases/create-savings-goal.use-case';

/** TASK-FIN-004 Stage C (Chapter 8 §8.9) — Savings Goal use cases. Same repository-binding split as `AccountModule`/`TransferModule`. */
@Module({
  providers: [CreateSavingsGoalUseCase, ContributeToSavingsGoalUseCase],
  exports: [CreateSavingsGoalUseCase, ContributeToSavingsGoalUseCase],
})
export class SavingsGoalModule {}

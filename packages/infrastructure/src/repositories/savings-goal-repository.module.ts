import { Global, Module } from '@nestjs/common';
import { SAVINGS_GOAL_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaSavingsGoalRepository } from './prisma-savings-goal.repository';

/** Binds @afa/domain's SAVINGS_GOAL_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `loan-repository.module.ts`/`account-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: SAVINGS_GOAL_REPOSITORY, useClass: PrismaSavingsGoalRepository }],
  exports: [SAVINGS_GOAL_REPOSITORY],
})
export class SavingsGoalRepositoryModule {}

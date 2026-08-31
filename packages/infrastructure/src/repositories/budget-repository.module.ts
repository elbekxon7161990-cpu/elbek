import { Global, Module } from '@nestjs/common';
import { BUDGET_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaBudgetRepository } from './prisma-budget.repository';

/** Binds @afa/domain's BUDGET_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `debt-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: BUDGET_REPOSITORY, useClass: PrismaBudgetRepository }],
  exports: [BUDGET_REPOSITORY],
})
export class BudgetRepositoryModule {}

import { Global, Module } from '@nestjs/common';
import { EXPENSE_HISTORY_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaExpenseHistoryRepository } from './prisma-expense-history.repository';

/**
 * Binds @afa/domain's EXPENSE_HISTORY_REPOSITORY port to the Prisma
 * implementation. `@Global()` — see user-repository.module.ts's
 * TASK-MVP-002 comment for why a sibling import under a shared parent
 * module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: EXPENSE_HISTORY_REPOSITORY, useClass: PrismaExpenseHistoryRepository }],
  exports: [EXPENSE_HISTORY_REPOSITORY],
})
export class ExpenseHistoryRepositoryModule {}

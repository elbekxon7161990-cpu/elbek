import { Global, Module } from '@nestjs/common';
import { TRANSACTION_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaTransactionRepository } from './prisma-transaction.repository';

/**
 * Binds @afa/domain's TRANSACTION_REPOSITORY port to the Prisma implementation.
 * `@Global()` — see user-repository.module.ts's TASK-MVP-002 comment for
 * why a sibling import under a shared parent module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository }],
  exports: [TRANSACTION_REPOSITORY],
})
export class TransactionRepositoryModule {}

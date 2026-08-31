import { Global, Module } from '@nestjs/common';
import { DEBT_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaDebtRepository } from './prisma-debt.repository';

/** Binds @afa/domain's DEBT_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `transaction-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: DEBT_REPOSITORY, useClass: PrismaDebtRepository }],
  exports: [DEBT_REPOSITORY],
})
export class DebtRepositoryModule {}

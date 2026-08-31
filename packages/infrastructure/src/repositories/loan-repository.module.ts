import { Global, Module } from '@nestjs/common';
import { LOAN_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaLoanRepository } from './prisma-loan.repository';

/** Binds @afa/domain's LOAN_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `account-repository.module.ts`/`debt-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: LOAN_REPOSITORY, useClass: PrismaLoanRepository }],
  exports: [LOAN_REPOSITORY],
})
export class LoanRepositoryModule {}

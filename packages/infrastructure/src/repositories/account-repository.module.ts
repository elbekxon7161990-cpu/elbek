import { Global, Module } from '@nestjs/common';
import { ACCOUNT_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAccountRepository } from './prisma-account.repository';

/** Binds @afa/domain's ACCOUNT_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `debt-repository.module.ts`/`budget-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository }],
  exports: [ACCOUNT_REPOSITORY],
})
export class AccountRepositoryModule {}

import { Global, Module } from '@nestjs/common';
import { COUNTERPARTY_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaCounterpartyRepository } from './prisma-counterparty.repository';

/** Binds @afa/domain's COUNTERPARTY_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `transaction-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: COUNTERPARTY_REPOSITORY, useClass: PrismaCounterpartyRepository }],
  exports: [COUNTERPARTY_REPOSITORY],
})
export class CounterpartyRepositoryModule {}

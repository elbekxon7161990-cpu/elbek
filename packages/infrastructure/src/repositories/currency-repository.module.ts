import { Global, Module } from '@nestjs/common';
import { CURRENCY_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaCurrencyRepository } from './prisma-currency.repository';

/**
 * Binds @afa/domain's CURRENCY_REPOSITORY port to the Prisma implementation.
 * `@Global()` — see user-repository.module.ts's TASK-MVP-002 comment for
 * why a sibling import under a shared parent module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: CURRENCY_REPOSITORY, useClass: PrismaCurrencyRepository }],
  exports: [CURRENCY_REPOSITORY],
})
export class CurrencyRepositoryModule {}

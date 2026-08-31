import { Global, Module } from '@nestjs/common';
import { FX_RATE_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaFxRateRepository } from './prisma-fx-rate.repository';

/** Binds @afa/domain's FX_RATE_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `account-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: FX_RATE_REPOSITORY, useClass: PrismaFxRateRepository }],
  exports: [FX_RATE_REPOSITORY],
})
export class FxRateRepositoryModule {}

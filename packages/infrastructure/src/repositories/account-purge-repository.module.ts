import { Global, Module } from '@nestjs/common';
import { ACCOUNT_PURGE_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAccountPurgeRepository } from './prisma-account-purge.repository';

/**
 * Binds @afa/domain's ACCOUNT_PURGE_REPOSITORY port to the Prisma
 * implementation. Does not bind `OBJECT_STORAGE` — `PrismaAccountPurgeRepository`
 * depends on it too, but binding domain ports to real implementations is
 * the composition root's own job everywhere else in this codebase
 * (`ai-extraction.module.ts`'s own doc comment); the composition root that
 * imports this module must also make `OBJECT_STORAGE` resolvable.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: ACCOUNT_PURGE_REPOSITORY, useClass: PrismaAccountPurgeRepository }],
  exports: [ACCOUNT_PURGE_REPOSITORY],
})
export class AccountPurgeRepositoryModule {}

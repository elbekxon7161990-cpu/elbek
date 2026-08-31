import { Global, Module } from '@nestjs/common';
import { DRAFT_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaDraftRepository } from './prisma-draft.repository';

/**
 * Binds @afa/domain's DRAFT_REPOSITORY port to the Prisma implementation.
 * `@Global()` — see user-repository.module.ts's TASK-MVP-002 comment for
 * why a sibling import under a shared parent module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: DRAFT_REPOSITORY, useClass: PrismaDraftRepository }],
  exports: [DRAFT_REPOSITORY],
})
export class DraftRepositoryModule {}

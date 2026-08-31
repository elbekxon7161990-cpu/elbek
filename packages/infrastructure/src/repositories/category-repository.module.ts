import { Global, Module } from '@nestjs/common';
import { CATEGORY_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaCategoryRepository } from './prisma-category.repository';

/**
 * Binds @afa/domain's CATEGORY_REPOSITORY port to the Prisma implementation.
 * `@Global()` — see user-repository.module.ts's TASK-MVP-002 comment for
 * why a sibling import under a shared parent module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository }],
  exports: [CATEGORY_REPOSITORY],
})
export class CategoryRepositoryModule {}

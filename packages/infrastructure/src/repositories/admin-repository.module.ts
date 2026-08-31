import { Global, Module } from '@nestjs/common';
import { ADMIN_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAdminRepository } from './prisma-admin.repository';

/**
 * TASK-AUTH-002 — binds @afa/domain's ADMIN_REPOSITORY port to the Prisma
 * implementation. `@Global()` — same precedent as `UserRepositoryModule`
 * (see that module's own doc comment for why: a module can only resolve
 * dependencies from its own providers or modules it directly imports, never
 * from an unrelated sibling under the same parent).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: ADMIN_REPOSITORY, useClass: PrismaAdminRepository }],
  exports: [ADMIN_REPOSITORY],
})
export class AdminRepositoryModule {}

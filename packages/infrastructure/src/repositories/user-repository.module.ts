import { Global, Module } from '@nestjs/common';
import { USER_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaUserRepository } from './prisma-user.repository';

/**
 * Binds @afa/domain's USER_REPOSITORY port to the Prisma implementation.
 *
 * TASK-MVP-002 — corrected to `@Global()` (matching `PrismaModule`/
 * `RedisModule`'s own precedent in this codebase). The original "not
 * @Global — only apps/* that actually use ProvisionTelegramUserUseCase
 * import this" reasoning assumed that an app importing both this module
 * and `AuthModule` as siblings (e.g. `TelegramBotModule`) would make
 * `USER_REPOSITORY` visible to `AuthModule`'s own `ProvisionTelegramUserUseCase`
 * provider — NestJS module scoping does not work that way: a module can
 * only resolve dependencies from its own providers or modules it directly
 * imports, never from an unrelated sibling under the same parent. This was
 * never caught because no test previously booted the real, full NestJS DI
 * graph (every existing test either unit-tests the use case directly with
 * a mocked repository, or is a `Test.createTestingModule` built from a
 * hand-picked provider list) — discovered by TASK-MVP-002 actually booting
 * the compiled `AppModule` for the first time.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: USER_REPOSITORY, useClass: PrismaUserRepository }],
  exports: [USER_REPOSITORY],
})
export class UserRepositoryModule {}

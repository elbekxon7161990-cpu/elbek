import { Global, Module } from '@nestjs/common';
import { USER_PREFERENCE_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaUserPreferenceRepository } from './prisma-user-preference.repository';

/** Binds @afa/domain's USER_PREFERENCE_REPOSITORY port to the Prisma implementation. `@Global()` — mirrors `NotificationPreferenceRepositoryModule`'s own convention. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: USER_PREFERENCE_REPOSITORY, useClass: PrismaUserPreferenceRepository }],
  exports: [USER_PREFERENCE_REPOSITORY],
})
export class UserPreferenceRepositoryModule {}

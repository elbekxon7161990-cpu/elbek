import { Global, Module } from '@nestjs/common';
import { ADMIN_ELEVATION_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAdminElevationRepository } from './prisma-admin-elevation.repository';

/** TASK-AUTH-005 — binds ADMIN_ELEVATION_REPOSITORY. `@Global()`, same precedent as `ApiTokenRepositoryModule`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: ADMIN_ELEVATION_REPOSITORY, useClass: PrismaAdminElevationRepository }],
  exports: [ADMIN_ELEVATION_REPOSITORY],
})
export class AdminElevationRepositoryModule {}

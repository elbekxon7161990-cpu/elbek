import { Global, Module } from '@nestjs/common';
import { SUPPORT_SESSION_ELEVATION_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaSupportSessionElevationRepository } from './prisma-support-session-elevation.repository';

/** TASK-SEC-006 — binds SUPPORT_SESSION_ELEVATION_REPOSITORY. `@Global()`, same precedent as sibling repository modules. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: SUPPORT_SESSION_ELEVATION_REPOSITORY,
      useClass: PrismaSupportSessionElevationRepository,
    },
  ],
  exports: [SUPPORT_SESSION_ELEVATION_REPOSITORY],
})
export class SupportSessionElevationRepositoryModule {}

import { Global, Module } from '@nestjs/common';
import { SUPPORT_SESSION_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaSupportSessionRepository } from './prisma-support-session.repository';

/** TASK-SEC-006 — binds SUPPORT_SESSION_REPOSITORY. `@Global()`, same precedent as `AdminElevationRepositoryModule`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: SUPPORT_SESSION_REPOSITORY, useClass: PrismaSupportSessionRepository }],
  exports: [SUPPORT_SESSION_REPOSITORY],
})
export class SupportSessionRepositoryModule {}

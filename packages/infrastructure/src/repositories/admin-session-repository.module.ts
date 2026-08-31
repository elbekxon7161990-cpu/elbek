import { Global, Module } from '@nestjs/common';
import { ADMIN_SESSION_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAdminSessionRepository } from './prisma-admin-session.repository';

/** TASK-AUTH-002 — binds ADMIN_SESSION_REPOSITORY, same `@Global()` precedent as `AdminRepositoryModule`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: ADMIN_SESSION_REPOSITORY, useClass: PrismaAdminSessionRepository }],
  exports: [ADMIN_SESSION_REPOSITORY],
})
export class AdminSessionRepositoryModule {}

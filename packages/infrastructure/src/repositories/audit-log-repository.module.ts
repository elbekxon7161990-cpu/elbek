import { Global, Module } from '@nestjs/common';
import { AUDIT_LOG_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAuditLogRepository } from './prisma-audit-log.repository';

/** TASK-AUTH-005 — binds AUDIT_LOG_REPOSITORY. `@Global()`, same precedent as `ApiTokenRepositoryModule`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository }],
  exports: [AUDIT_LOG_REPOSITORY],
})
export class AuditLogRepositoryModule {}

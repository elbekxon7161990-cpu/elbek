import { Global, Module } from '@nestjs/common';
import { TRANSACTION_AUDIT_LOG_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaTransactionAuditLogRepository } from './prisma-transaction-audit-log.repository';

/**
 * Binds @afa/domain's TRANSACTION_AUDIT_LOG_REPOSITORY port to the Prisma
 * implementation. `@Global()` — see user-repository.module.ts's
 * TASK-MVP-002 comment for why a sibling import under a shared parent
 * module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: TRANSACTION_AUDIT_LOG_REPOSITORY, useClass: PrismaTransactionAuditLogRepository },
  ],
  exports: [TRANSACTION_AUDIT_LOG_REPOSITORY],
})
export class TransactionAuditLogRepositoryModule {}

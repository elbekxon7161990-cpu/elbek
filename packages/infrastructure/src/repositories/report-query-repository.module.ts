import { Global, Module } from '@nestjs/common';
import { REPORT_QUERY_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaReportQueryRepository } from './prisma-report-query.repository';

/**
 * Binds @afa/domain's REPORT_QUERY_REPOSITORY port to the Prisma
 * implementation. `@Global()` — see user-repository.module.ts's
 * TASK-MVP-002 comment for why a sibling import under a shared parent
 * module is not sufficient.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: REPORT_QUERY_REPOSITORY, useClass: PrismaReportQueryRepository }],
  exports: [REPORT_QUERY_REPOSITORY],
})
export class ReportQueryRepositoryModule {}

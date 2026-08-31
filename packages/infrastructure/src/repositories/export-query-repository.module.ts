import { Global, Module } from '@nestjs/common';
import { EXPORT_QUERY_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaExportQueryRepository } from './prisma-export-query.repository';

/**
 * Binds @afa/domain's EXPORT_QUERY_REPOSITORY port to the Prisma
 * implementation. `@Global()` — mirrors `ReportQueryRepositoryModule`'s own
 * convention exactly.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: EXPORT_QUERY_REPOSITORY, useClass: PrismaExportQueryRepository }],
  exports: [EXPORT_QUERY_REPOSITORY],
})
export class ExportQueryRepositoryModule {}

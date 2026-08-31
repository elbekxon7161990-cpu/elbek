import { Module } from '@nestjs/common';

import { GenerateReportUseCase } from '../use-cases/generate-report.use-case';

/**
 * TASK-REP-007 — does not bind `REPORT_QUERY_REPOSITORY`/`REPORT_CACHE_REPOSITORY`;
 * binding domain ports to real implementations is the composition root's
 * job, the same split as every other module in this package.
 */
@Module({
  providers: [GenerateReportUseCase],
  exports: [GenerateReportUseCase],
})
export class GenerateReportModule {}

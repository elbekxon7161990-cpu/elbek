import { Module } from '@nestjs/common';

import { GenerateDashboardUseCase } from '../use-cases/generate-dashboard.use-case';

/**
 * TASK-REP-004 — does not bind `USER_REPOSITORY`/`REPORT_QUERY_REPOSITORY`/
 * `BUDGET_REPOSITORY`/`DEBT_REPOSITORY`/`DRAFT_REPOSITORY`; binding domain
 * ports to real implementations is the composition root's job, the same
 * split `GenerateReportModule` already established.
 */
@Module({
  providers: [GenerateDashboardUseCase],
  exports: [GenerateDashboardUseCase],
})
export class GenerateDashboardModule {}

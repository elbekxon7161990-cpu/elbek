import { Module } from '@nestjs/common';

import { SearchTransactionsUseCase } from '../use-cases/search-transactions.use-case';

/**
 * TASK-FIN-012 — does not bind `REPORT_QUERY_REPOSITORY`; binding domain
 * ports to real implementations is the composition root's job, the same
 * split `GenerateDashboardModule`/`GenerateReportModule` already established.
 */
@Module({
  providers: [SearchTransactionsUseCase],
  exports: [SearchTransactionsUseCase],
})
export class SearchTransactionsModule {}

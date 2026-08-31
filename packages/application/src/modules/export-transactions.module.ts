import { Module } from '@nestjs/common';

import { ExportTransactionsUseCase } from '../use-cases/export-transactions.use-case';

/**
 * TASK-FIN-014 — does not bind `EXPORT_QUERY_REPOSITORY`/`XLSX_GENERATOR`;
 * binding domain ports to real implementations is the composition root's
 * job, the same split `GenerateReportModule` already uses.
 */
@Module({
  providers: [ExportTransactionsUseCase],
  exports: [ExportTransactionsUseCase],
})
export class ExportTransactionsModule {}

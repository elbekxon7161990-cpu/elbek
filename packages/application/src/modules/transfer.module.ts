import { Module } from '@nestjs/common';

import { CreateTransferUseCase } from '../use-cases/create-transfer.use-case';

/**
 * TASK-FIN-004 Stage C (Chapter 8 §8.7) — Transfer use case. Does not bind
 * any domain repository port to its infrastructure implementation — same
 * split as `AccountModule`/`BudgetModule`: that is the composition root's
 * job, imported alongside this module by whichever apps/* app needs it.
 */
@Module({
  providers: [CreateTransferUseCase],
  exports: [CreateTransferUseCase],
})
export class TransferModule {}

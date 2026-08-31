import { Global, Module } from '@nestjs/common';
import { LOAN_WIZARD_STATE_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisLoanWizardStateRepository } from './redis-loan-wizard-state.repository';

/**
 * TASK-FIN-004 (Stage I) — binds @afa/domain's `LOAN_WIZARD_STATE_REPOSITORY`
 * port to the Redis implementation. Mirrors `ConversationStateRepositoryModule`'s
 * own shape exactly, including `@Global()` for the same reason (a single
 * shared binding regardless of which composition-root module imports it
 * first).
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [{ provide: LOAN_WIZARD_STATE_REPOSITORY, useClass: RedisLoanWizardStateRepository }],
  exports: [LOAN_WIZARD_STATE_REPOSITORY],
})
export class LoanWizardStateRepositoryModule {}

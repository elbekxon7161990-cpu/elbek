import { Global, Module } from '@nestjs/common';
import { SEARCH_SESSION_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisSearchSessionRepository } from './redis-search-session.repository';

/**
 * TASK-FIN-012 — binds @afa/domain's `SEARCH_SESSION_REPOSITORY` port to the
 * Redis implementation. Mirrors `LoanWizardStateRepositoryModule`'s own
 * shape exactly, including `@Global()` for the same reason.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [{ provide: SEARCH_SESSION_REPOSITORY, useClass: RedisSearchSessionRepository }],
  exports: [SEARCH_SESSION_REPOSITORY],
})
export class SearchSessionRepositoryModule {}

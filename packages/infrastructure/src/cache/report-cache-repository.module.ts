import { Global, Module } from '@nestjs/common';
import { REPORT_CACHE_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisReportCacheRepository } from './redis-report-cache.repository';

/**
 * Binds @afa/domain's REPORT_CACHE_REPOSITORY port to the Redis
 * implementation. `@Global()` — see user-repository.module.ts's
 * TASK-MVP-002 comment for why a sibling import under a shared parent
 * module is not sufficient.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [{ provide: REPORT_CACHE_REPOSITORY, useClass: RedisReportCacheRepository }],
  exports: [REPORT_CACHE_REPOSITORY],
})
export class ReportCacheRepositoryModule {}

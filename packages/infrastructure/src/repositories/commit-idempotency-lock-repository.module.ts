import { Global, Module } from '@nestjs/common';
import { COMMIT_IDEMPOTENCY_LOCK } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisCommitIdempotencyLock } from './redis-commit-idempotency-lock.repository';

/**
 * Binds @afa/domain's COMMIT_IDEMPOTENCY_LOCK port to the Redis
 * implementation. `@Global()` — see user-repository.module.ts's
 * TASK-MVP-002 comment for why a sibling import under a shared parent
 * module is not sufficient.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [{ provide: COMMIT_IDEMPOTENCY_LOCK, useClass: RedisCommitIdempotencyLock }],
  exports: [COMMIT_IDEMPOTENCY_LOCK],
})
export class CommitIdempotencyLockRepositoryModule {}

import { Global, Module } from '@nestjs/common';
import { ACCOUNT_DELETION_CONFIRMATION_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisAccountDeletionConfirmationRepository } from './redis-account-deletion-confirmation.repository';

/**
 * TASK-AUTH-006 — binds @afa/domain's
 * `ACCOUNT_DELETION_CONFIRMATION_REPOSITORY` port to the Redis
 * implementation. Mirrors `SearchSessionRepositoryModule`'s own shape
 * exactly, including `@Global()` for the same reason.
 */
@Global()
@Module({
  providers: [
    {
      provide: ACCOUNT_DELETION_CONFIRMATION_REPOSITORY,
      useClass: RedisAccountDeletionConfirmationRepository,
    },
  ],
  imports: [RedisModule],
  exports: [ACCOUNT_DELETION_CONFIRMATION_REPOSITORY],
})
export class AccountDeletionConfirmationRepositoryModule {}

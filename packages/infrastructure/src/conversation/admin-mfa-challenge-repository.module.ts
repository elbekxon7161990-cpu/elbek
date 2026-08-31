import { Global, Module } from '@nestjs/common';
import { ADMIN_MFA_CHALLENGE_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisAdminMfaChallengeRepository } from './redis-admin-mfa-challenge.repository';

/** TASK-AUTH-002 — binds ADMIN_MFA_CHALLENGE_REPOSITORY. `@Global()`, same precedent as `ConversationStateRepositoryModule`. */
@Global()
@Module({
  imports: [RedisModule],
  providers: [
    { provide: ADMIN_MFA_CHALLENGE_REPOSITORY, useClass: RedisAdminMfaChallengeRepository },
  ],
  exports: [ADMIN_MFA_CHALLENGE_REPOSITORY],
})
export class AdminMfaChallengeRepositoryModule {}

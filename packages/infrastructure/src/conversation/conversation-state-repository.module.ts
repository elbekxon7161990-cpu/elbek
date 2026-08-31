import { Global, Module } from '@nestjs/common';
import { CONVERSATION_STATE_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisConversationStateRepository } from './redis-conversation-state.repository';

/**
 * Binds @afa/domain's CONVERSATION_STATE_REPOSITORY port to the Redis
 * implementation. Unlike TASK-AI-005/006's `STT_PROVIDER`/`OCR_PROVIDER`
 * (which have no concrete adapter — REAL_PROVIDER_STATUS = ENVIRONMENT-
 * BLOCKED, no vendor credentials), Redis is already a real, wired
 * dependency in this codebase (`RedisModule`/`REDIS_CLIENT`), so this
 * binding is a genuine production adapter, not a fake standing in for one.
 *
 * `TRANSACTION_COMMIT_PORT` is deliberately NOT bound anywhere yet — see
 * that port's own doc comment for the discovered category-code resolution
 * gap blocking a real adapter; a composition root wiring this module must
 * also provide its own `TRANSACTION_COMMIT_PORT` binding (a fake for now).
 *
 * `@Global()` (TASK-MVP-002) — see user-repository.module.ts's TASK-MVP-002
 * comment for why a sibling import under a shared parent module is not
 * sufficient.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [
    { provide: CONVERSATION_STATE_REPOSITORY, useClass: RedisConversationStateRepository },
  ],
  exports: [CONVERSATION_STATE_REPOSITORY],
})
export class ConversationStateRepositoryModule {}

import { Inject, Injectable } from '@nestjs/common';
import type { CommitIdempotencyLockPort } from '@afa/domain';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { RedisClient } from '../redis/redis.constants';

/** Distinguishes "claimed, commit still in flight" from "claimed and resolved" — a losing caller reading this value back knows to report `TransactionCommitInProgressError` rather than treating it as a real transactionId. */
const PENDING_MARKER = '__PENDING__';

/**
 * TASK-FIN-REAL-001 — `CommitIdempotencyLockPort`'s real implementation,
 * the same atomic `SET ... NX` pattern already used twice in this codebase
 * (`TelegramUpdateDedupService`, TASK-BOT-001; `RedisConversationStateRepository`'s
 * compare-and-set, TASK-BOT-002) rather than a fourth, different mechanism.
 */
@Injectable()
export class RedisCommitIdempotencyLock implements CommitIdempotencyLockPort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async tryClaim(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, PENDING_MARKER, 'EX', ttlSeconds, 'NX');
    return result !== null;
  }

  async getResult(key: string): Promise<string | null> {
    const value = await this.redis.get(key);
    return value && value !== PENDING_MARKER ? value : null;
  }

  async storeResult(key: string, result: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, result, 'EX', ttlSeconds);
  }

  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

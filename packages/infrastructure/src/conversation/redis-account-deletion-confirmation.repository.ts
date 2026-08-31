import { Inject, Injectable } from '@nestjs/common';
import type { AccountDeletionConfirmationRepository } from '@afa/domain';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { RedisClient } from '../redis/redis.constants';

function keyFor(userId: string): string {
  return `account_deletion_confirmation:${userId}`;
}

/**
 * TASK-AUTH-006 — `AccountDeletionConfirmationRepository` adapter. A plain
 * TTL-bounded flag (`SET ... PX` / `EXISTS` / `DEL`), not a compare-and-set
 * record — see the port's own doc comment for why a full CAS primitive
 * (`LoanWizardStateRepository`/`SearchSessionRepository`'s own shape) is
 * more than this specific flag needs. Reuses the already-established
 * `REDIS_CLIENT` connection, same as every other Redis-backed repository in
 * this codebase.
 */
@Injectable()
export class RedisAccountDeletionConfirmationRepository implements AccountDeletionConfirmationRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async markAwaitingConfirmation(userId: string, expiresAt: Date): Promise<void> {
    const ttlMs = Math.max(expiresAt.getTime() - Date.now(), 1);
    await this.redis.set(keyFor(userId), '1', 'PX', ttlMs);
  }

  async isAwaitingConfirmation(userId: string): Promise<boolean> {
    const result = await this.redis.exists(keyFor(userId));
    return result === 1;
  }

  async clear(userId: string): Promise<void> {
    await this.redis.del(keyFor(userId));
  }
}

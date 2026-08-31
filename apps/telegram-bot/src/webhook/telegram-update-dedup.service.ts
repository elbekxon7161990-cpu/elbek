import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '@afa/infrastructure';
import type { RedisClient } from '@afa/infrastructure';

const DEDUP_TTL_SECONDS = 24 * 60 * 60;

/**
 * TASK-BOT-001 — Telegram redelivers an update (webhook retry, or the same
 * update replayed after a transient failure) using the *same* `update_id`.
 * This is transport-level delivery deduplication (an atomic Redis `SET NX`,
 * not a naive read-then-write), distinct from and complementary to
 * TASK-BOT-002's own state-based idempotency (a stale/duplicate
 * *ConversationEvent* against an already-transitioned state fails the
 * guard table) — this class catches the case where the exact same physical
 * delivery arrives twice; BOT-002 catches the case where two *different*
 * deliveries would otherwise both mutate state.
 */
@Injectable()
export class TelegramUpdateDedupService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  /** Returns `true` if this `updateId` has already been seen (caller must skip processing but still ack), `false` if this is the first time. */
  async isDuplicate(updateId: number): Promise<boolean> {
    const key = `telegram_update:${updateId}`;
    const result = await this.redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    return result === null;
  }
}

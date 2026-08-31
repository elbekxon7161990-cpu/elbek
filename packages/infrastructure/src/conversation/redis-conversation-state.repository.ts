import { Inject, Injectable } from '@nestjs/common';
import type { ConversationStateRecord, ConversationStateRepository } from '@afa/domain';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { RedisClient } from '../redis/redis.constants';

/**
 * BR-CE-006's atomic compare-and-set as a single Lua script (`EVAL`), so
 * the read-check-write is one indivisible operation on the Redis server —
 * not a client-side GET followed by a separate SET, which would reopen the
 * exact race BR-CE-006 forbids ("not a naive read-then-write"). The script
 * decodes the stored JSON's own `version` field (defaulting to `0` when the
 * key is absent, matching `ProcessConversationEventUseCase`'s own "no prior
 * record = version 0" convention) and only writes when it matches
 * `expectedVersion`. `ARGV[3]` is milliseconds-until-expiry (`-1` for no
 * TTL, i.e. IDLE) — set/cleared atomically alongside the value so the
 * stored record's own `expiresAt` and Redis's own key TTL never drift
 * apart. Read-time expiry enforcement (§5.19.2 — "independent of whether a
 * background expiry job actually ran") stays the application layer's job
 * (`isConversationStateExpired`); the Redis TTL here is only a storage-
 * hygiene backstop, never the source of truth for whether a state is
 * usable.
 */
const COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local expectedVersion = tonumber(ARGV[1])
local newValue = ARGV[2]
local ttlMs = tonumber(ARGV[3])

local currentVersion = 0
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded.version then
    currentVersion = decoded.version
  end
end

if currentVersion ~= expectedVersion then
  return 0
end

if ttlMs >= 0 then
  redis.call('SET', KEYS[1], newValue, 'PX', ttlMs)
else
  redis.call('SET', KEYS[1], newValue)
end
return 1
`;

function keyFor(userId: string): string {
  return `conversation_state:${userId}`;
}

/**
 * TASK-BOT-002's `ConversationStateRepository` adapter (§5.12.1's "State
 * Reader/Writer": "Reads and atomically mutates `conversation_state:{user_id}`
 * in Redis"). Reuses the already-established `REDIS_CLIENT` connection
 * (TASK-INFRA's `RedisModule`), never opens a second connection.
 */
@Injectable()
export class RedisConversationStateRepository implements ConversationStateRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async get(userId: string): Promise<ConversationStateRecord | null> {
    const raw = await this.redis.get(keyFor(userId));
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as ConversationStateRecord;
  }

  async compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: ConversationStateRecord,
  ): Promise<boolean> {
    // -1 is the "no TTL" sentinel (IDLE); any other case is clamped to at
    // least 1ms so a record whose expiry has *just* passed still writes
    // successfully (§5.19.2's read-time check is the actual expiry
    // enforcement — this TTL is only storage hygiene, never the source of
    // truth), rather than colliding with the -1 sentinel at exactly 0.
    const ttlMs =
      newRecord.expiresAt === null
        ? -1
        : Math.max(new Date(newRecord.expiresAt).getTime() - Date.now(), 1);
    const result = await this.redis.eval(
      COMPARE_AND_SET_SCRIPT,
      1,
      keyFor(userId),
      expectedVersion,
      JSON.stringify(newRecord),
      ttlMs,
    );
    return result === 1;
  }
}

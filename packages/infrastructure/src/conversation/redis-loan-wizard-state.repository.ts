import { Inject, Injectable } from '@nestjs/common';
import type { LoanWizardStateRecord, LoanWizardStateRepository } from '@afa/domain';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { RedisClient } from '../redis/redis.constants';

/**
 * TASK-FIN-004 (Stage I) — same atomic compare-and-set Lua script shape as
 * `RedisConversationStateRepository` (BR-CE-006's reasoning generalized: the
 * read-check-write is one indivisible Redis-server-side operation, never a
 * client-side GET-then-SET). The one addition: `ARGV[2] === ''` is the
 * "delete" sentinel (this port's `compareAndSet(..., null)` case, which
 * `ConversationStateRepository` has no equivalent of, since it always has a
 * concrete `IDLE` record to fall back to instead of key absence).
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

if newValue == '' then
  redis.call('DEL', KEYS[1])
elseif ttlMs >= 0 then
  redis.call('SET', KEYS[1], newValue, 'PX', ttlMs)
else
  redis.call('SET', KEYS[1], newValue)
end
return 1
`;

function keyFor(userId: string): string {
  return `loan_wizard:${userId}`;
}

/**
 * TASK-FIN-004 (Stage I) — `LoanWizardStateRepository` adapter. Reuses the
 * already-established `REDIS_CLIENT` connection (same singleton
 * `RedisModule` every other Redis-backed repository in this codebase
 * shares), never opens a second connection.
 */
@Injectable()
export class RedisLoanWizardStateRepository implements LoanWizardStateRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async get(userId: string): Promise<LoanWizardStateRecord | null> {
    const raw = await this.redis.get(keyFor(userId));
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as LoanWizardStateRecord;
  }

  async compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: LoanWizardStateRecord | null,
  ): Promise<boolean> {
    if (newRecord === null) {
      const result = await this.redis.eval(
        COMPARE_AND_SET_SCRIPT,
        1,
        keyFor(userId),
        expectedVersion,
        '',
        0,
      );
      return result === 1;
    }
    const ttlMs = Math.max(new Date(newRecord.expiresAt).getTime() - Date.now(), 1);
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

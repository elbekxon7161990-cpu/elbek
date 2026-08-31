import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminMfaChallenge, AdminMfaChallengeRepository } from '@afa/domain';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { RedisClient } from '../redis/redis.constants';

function keyFor(challengeToken: string): string {
  return `admin_mfa_challenge:${challengeToken}`;
}

/**
 * TASK-AUTH-002 — same "ephemeral, TTL-backed, Redis" shape as
 * `RedisSearchSessionRepository`, simplified: a challenge is written once
 * (password step), read/consumed by whoever presents the token (MFA step),
 * never concurrently updated by two writers — no compare-and-set needed,
 * unlike the search-session port.
 */
@Injectable()
export class RedisAdminMfaChallengeRepository implements AdminMfaChallengeRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async create(adminId: string, ttlMs: number): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const payload: AdminMfaChallenge = { adminId, createdAt: new Date() };
    await this.redis.set(keyFor(token), JSON.stringify(payload), 'PX', ttlMs);
    return token;
  }

  async get(challengeToken: string): Promise<AdminMfaChallenge | null> {
    const raw = await this.redis.get(keyFor(challengeToken));
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as AdminMfaChallenge;
    return { adminId: parsed.adminId, createdAt: new Date(parsed.createdAt) };
  }

  async consume(challengeToken: string): Promise<void> {
    await this.redis.del(keyFor(challengeToken));
  }
}

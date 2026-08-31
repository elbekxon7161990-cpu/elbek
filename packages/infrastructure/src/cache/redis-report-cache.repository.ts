import { Inject, Injectable } from '@nestjs/common';
import type { ReportCachePeriod, ReportCacheRepository, ReportPeriodType } from '@afa/domain';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';

function buildKey(userId: string, reportType: ReportPeriodType, periodKey: string): string {
  return `report:${userId}:${reportType}:${periodKey}`;
}

/**
 * TASK-DB-009 (FR-DB-025, Chapter 13 §13.38.2) — implements
 * `ReportCacheRepository` against the shared `REDIS_CLIENT` (no second
 * Redis connection; `redis.module.ts`'s own doc comment already names this
 * exact use case as the one it was provisioned for).
 *
 * `invalidate` deletes, never updates-in-place, per FR-DB-025's own
 * wording — this repository has no method that could write a stale value
 * back, by construction. A plain `DEL` on a key that is already absent (a
 * duplicate delivery, or a key that was never populated because the Report
 * Service itself does not exist yet — this task's own explicit scope
 * boundary) is a documented Redis no-op, which is exactly the idempotency
 * this task's own requirements ask for — no extra guard needed.
 */
@Injectable()
export class RedisReportCacheRepository implements ReportCacheRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async invalidate(userId: string, periods: ReportCachePeriod[]): Promise<void> {
    if (periods.length === 0) {
      return;
    }
    const keys = periods.map((period) => buildKey(userId, period.reportType, period.periodKey));
    await this.redis.del(...keys);
  }

  async get(
    userId: string,
    reportType: ReportPeriodType,
    periodKey: string,
  ): Promise<string | null> {
    return this.redis.get(buildKey(userId, reportType, periodKey));
  }

  async set(
    userId: string,
    reportType: ReportPeriodType,
    periodKey: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(buildKey(userId, reportType, periodKey), value, 'EX', ttlSeconds);
  }
}

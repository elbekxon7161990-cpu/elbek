import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';

import { RedisReportCacheRepository } from './redis-report-cache.repository';

function fakeRedis(): Redis {
  return { del: vi.fn().mockResolvedValue(0) } as unknown as Redis;
}

describe('RedisReportCacheRepository', () => {
  it('constructs the exact report:{user_id}:{report_type}:{period_key} key schema', async () => {
    const redis = fakeRedis();
    const repository = new RedisReportCacheRepository(redis);

    await repository.invalidate('user-1', [
      { reportType: 'monthly', periodKey: '2026-01' },
      { reportType: 'yearly', periodKey: '2026' },
    ]);

    expect(redis.del).toHaveBeenCalledWith(
      'report:user-1:monthly:2026-01',
      'report:user-1:yearly:2026',
    );
  });

  it('is a no-op (never calls redis.del) when given an empty period list', async () => {
    const redis = fakeRedis();
    const repository = new RedisReportCacheRepository(redis);

    await repository.invalidate('user-1', []);

    expect(redis.del).not.toHaveBeenCalled();
  });

  it('deleting the same keys twice is safe — the second call succeeds identically even though the keys are already gone', async () => {
    const redis = fakeRedis();
    const repository = new RedisReportCacheRepository(redis);
    const periods = [{ reportType: 'monthly' as const, periodKey: '2026-01' }];

    await repository.invalidate('user-1', periods);
    await expect(repository.invalidate('user-1', periods)).resolves.toBeUndefined();

    expect(redis.del).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenNthCalledWith(1, 'report:user-1:monthly:2026-01');
    expect(redis.del).toHaveBeenNthCalledWith(2, 'report:user-1:monthly:2026-01');
  });
});

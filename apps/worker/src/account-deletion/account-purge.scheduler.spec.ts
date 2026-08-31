import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { ACCOUNT_PURGE_QUEUE_NAME } from '@afa/infrastructure';
import { AccountPurgeScheduler } from './account-purge.scheduler';

function fakeConfigService(scanIntervalMs?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'ACCOUNT_PURGE_SCAN_INTERVAL_MS') {
        return scanIntervalMs ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

describe('AccountPurgeScheduler', () => {
  it('registers a repeatable job at the configured scan interval, with no payload', async () => {
    const queue = fakeQueue();
    const scheduler = new AccountPurgeScheduler(queue, fakeConfigService(300_000));

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      ACCOUNT_PURGE_QUEUE_NAME,
      {},
      { repeat: { every: 300_000 } },
    );
  });

  it('falls back to 30 minutes when ACCOUNT_PURGE_SCAN_INTERVAL_MS is not configured', async () => {
    const queue = fakeQueue();
    const scheduler = new AccountPurgeScheduler(queue, fakeConfigService());

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      ACCOUNT_PURGE_QUEUE_NAME,
      {},
      { repeat: { every: 30 * 60 * 1000 } },
    );
  });
});

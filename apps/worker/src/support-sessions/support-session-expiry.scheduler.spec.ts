import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { SUPPORT_SESSION_EXPIRY_QUEUE_NAME } from '@afa/infrastructure';
import { SupportSessionExpiryScheduler } from './support-session-expiry.scheduler';

function fakeConfigService(scanIntervalMs?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'SUPPORT_SESSION_EXPIRY_SCAN_INTERVAL_MS') {
        return scanIntervalMs ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

describe('SupportSessionExpiryScheduler', () => {
  it('registers a repeatable job at the configured scan interval, with no payload', async () => {
    const queue = fakeQueue();
    const scheduler = new SupportSessionExpiryScheduler(queue, fakeConfigService(60_000));

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      SUPPORT_SESSION_EXPIRY_QUEUE_NAME,
      {},
      { repeat: { every: 60_000 } },
    );
  });

  it('falls back to 5 minutes when SUPPORT_SESSION_EXPIRY_SCAN_INTERVAL_MS is not configured', async () => {
    const queue = fakeQueue();
    const scheduler = new SupportSessionExpiryScheduler(queue, fakeConfigService());

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      SUPPORT_SESSION_EXPIRY_QUEUE_NAME,
      {},
      { repeat: { every: 5 * 60 * 1000 } },
    );
  });
});

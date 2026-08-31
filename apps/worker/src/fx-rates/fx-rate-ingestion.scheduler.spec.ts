import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { FX_RATE_INGESTION_QUEUE_NAME } from '@afa/infrastructure';
import { FxRateIngestionScheduler } from './fx-rate-ingestion.scheduler';

function fakeConfigService(intervalMs?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'FX_RATE_INGESTION_INTERVAL_MS') {
        return intervalMs ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

describe('FxRateIngestionScheduler', () => {
  it('registers a repeatable job at the configured interval, with no payload', async () => {
    const queue = fakeQueue();
    const scheduler = new FxRateIngestionScheduler(queue, fakeConfigService(3_600_000));

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      FX_RATE_INGESTION_QUEUE_NAME,
      {},
      { repeat: { every: 3_600_000 } },
    );
  });

  it('falls back to 24 hours when FX_RATE_INGESTION_INTERVAL_MS is not configured (FR-INT-003 — "at least daily")', async () => {
    const queue = fakeQueue();
    const scheduler = new FxRateIngestionScheduler(queue, fakeConfigService());

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      FX_RATE_INGESTION_QUEUE_NAME,
      {},
      { repeat: { every: 24 * 60 * 60 * 1000 } },
    );
  });
});

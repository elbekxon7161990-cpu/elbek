import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { BUDGET_ROLLOVER_QUEUE_NAME } from '@afa/infrastructure';
import { BudgetRolloverScheduler } from './budget-rollover.scheduler';

function fakeConfigService(scanIntervalMs?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'BUDGET_ROLLOVER_SCAN_INTERVAL_MS') {
        return scanIntervalMs ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

describe('BudgetRolloverScheduler', () => {
  it('registers a repeatable job at the configured scan interval, with no payload', async () => {
    const queue = fakeQueue();
    const scheduler = new BudgetRolloverScheduler(queue, fakeConfigService(300_000));

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      BUDGET_ROLLOVER_QUEUE_NAME,
      {},
      { repeat: { every: 300_000 } },
    );
  });

  it('falls back to 10 minutes when BUDGET_ROLLOVER_SCAN_INTERVAL_MS is not configured', async () => {
    const queue = fakeQueue();
    const scheduler = new BudgetRolloverScheduler(queue, fakeConfigService());

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      BUDGET_ROLLOVER_QUEUE_NAME,
      {},
      { repeat: { every: 10 * 60 * 1000 } },
    );
  });
});

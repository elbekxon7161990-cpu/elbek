import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { DEBT_REMINDER_SCAN_QUEUE_NAME } from '@afa/infrastructure';
import { DebtReminderScanScheduler } from './debt-reminder-scan.scheduler';

function fakeConfigService(scanIntervalMs?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'DEBT_REMINDER_SCAN_INTERVAL_MS') {
        return scanIntervalMs ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

describe('DebtReminderScanScheduler', () => {
  it('registers a repeatable job at the configured scan interval, with no payload', async () => {
    const queue = fakeQueue();
    const scheduler = new DebtReminderScanScheduler(queue, fakeConfigService(3_600_000));

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      DEBT_REMINDER_SCAN_QUEUE_NAME,
      {},
      { repeat: { every: 3_600_000 } },
    );
  });

  it('falls back to 24h when DEBT_REMINDER_SCAN_INTERVAL_MS is not configured', async () => {
    const queue = fakeQueue();
    const scheduler = new DebtReminderScanScheduler(queue, fakeConfigService());

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      DEBT_REMINDER_SCAN_QUEUE_NAME,
      {},
      { repeat: { every: 24 * 60 * 60 * 1000 } },
    );
  });
});

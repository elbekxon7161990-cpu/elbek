import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { DOMAIN_EVENT_DISPATCH_QUEUE_NAME } from '@afa/infrastructure';
import { DomainEventDispatchScheduler } from './domain-event-dispatch.scheduler';

function fakeConfigService(pollIntervalMs?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'DOMAIN_EVENT_POLL_INTERVAL_MS') {
        return pollIntervalMs ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

describe('DomainEventDispatchScheduler', () => {
  it('registers a repeatable job at the configured poll interval, with no payload', async () => {
    const queue = fakeQueue();
    const scheduler = new DomainEventDispatchScheduler(queue, fakeConfigService(2500));

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      DOMAIN_EVENT_DISPATCH_QUEUE_NAME,
      {},
      { repeat: { every: 2500 } },
    );
  });

  it('falls back to 1000ms when DOMAIN_EVENT_POLL_INTERVAL_MS is not configured', async () => {
    const queue = fakeQueue();
    const scheduler = new DomainEventDispatchScheduler(queue, fakeConfigService());

    await scheduler.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      DOMAIN_EVENT_DISPATCH_QUEUE_NAME,
      {},
      { repeat: { every: 1000 } },
    );
  });
});

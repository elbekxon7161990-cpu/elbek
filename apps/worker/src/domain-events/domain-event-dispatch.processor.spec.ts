import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { DispatchDomainEventsUseCase, DispatchedEventSummary } from '@afa/application';

import { DomainEventDispatchProcessor } from './domain-event-dispatch.processor';

function fakeConfigService(batchSize?: number): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'DOMAIN_EVENT_BATCH_SIZE') {
        return batchSize ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function fakeUseCase(summaries: DispatchedEventSummary[]): DispatchDomainEventsUseCase {
  return {
    dispatchBatch: vi.fn().mockResolvedValue(summaries),
  } as unknown as DispatchDomainEventsUseCase;
}

describe('DomainEventDispatchProcessor', () => {
  it('reads DOMAIN_EVENT_BATCH_SIZE from config and passes it to dispatchBatch', async () => {
    const useCase = fakeUseCase([]);
    const processor = new DomainEventDispatchProcessor(useCase, fakeConfigService(7));

    await processor.process();

    expect(useCase.dispatchBatch).toHaveBeenCalledWith(7);
  });

  it('falls back to 50 when DOMAIN_EVENT_BATCH_SIZE is not configured', async () => {
    const useCase = fakeUseCase([]);
    const processor = new DomainEventDispatchProcessor(useCase, fakeConfigService());

    await processor.process();

    expect(useCase.dispatchBatch).toHaveBeenCalledWith(50);
  });

  it('returns the count of events processed this cycle', async () => {
    const summaries: DispatchedEventSummary[] = [
      {
        eventId: 'evt-1',
        eventType: 'TransactionCommitted',
        outcome: 'dispatched',
        dispatchAttempts: 0,
      },
      {
        eventId: 'evt-2',
        eventType: 'TransactionCommitted',
        outcome: 'retry',
        dispatchAttempts: 1,
      },
    ];
    const processor = new DomainEventDispatchProcessor(fakeUseCase(summaries), fakeConfigService());

    const result = await processor.process();

    expect(result).toEqual({ processed: 2 });
  });

  it('never includes event payload contents in its log line — only id/type/outcome/attempts (Chapter 16 §16.3 data minimization)', async () => {
    const summaries: DispatchedEventSummary[] = [
      {
        eventId: 'evt-1',
        eventType: 'TransactionCommitted',
        outcome: 'dispatched',
        dispatchAttempts: 0,
      },
    ];
    const processor = new DomainEventDispatchProcessor(fakeUseCase(summaries), fakeConfigService());
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    expect(logSpy).toHaveBeenCalled();
    const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toMatch(/transactionId|userId|payload/i);
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own outer retry/observability)', async () => {
    const useCase: DispatchDomainEventsUseCase = {
      dispatchBatch: vi.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as DispatchDomainEventsUseCase;
    const processor = new DomainEventDispatchProcessor(useCase, fakeConfigService());

    await expect(processor.process()).rejects.toThrow('db unavailable');
  });
});

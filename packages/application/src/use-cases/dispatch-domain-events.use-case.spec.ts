import { describe, expect, it, vi } from 'vitest';
import type {
  DomainEventConsumer,
  DomainEventConsumerRegistry,
  DomainEventDispatchDecision,
  DomainEventDispatchResult,
  DomainEventRecord,
  DomainEventRepository,
  DomainEventType,
} from '@afa/domain';

import { DispatchDomainEventsUseCase } from './dispatch-domain-events.use-case';

function makeEvent(overrides: Partial<DomainEventRecord> = {}): DomainEventRecord {
  return {
    id: 'evt-1',
    eventType: 'TransactionCommitted',
    payload: { transactionId: 'txn-1', userId: 'user-1' },
    status: 'pending',
    dispatchAttempts: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    dispatchedAt: null,
    ...overrides,
  };
}

/**
 * Faithfully simulates the real repository's transactional claim (oldest
 * `pending` row first, the caller's decision applied atomically,
 * already-`dispatched`/`failed` rows never reconsidered) purely in memory —
 * enough to test `DispatchDomainEventsUseCase`'s own policy (consumer
 * routing, retry-vs-terminal threshold, unknown-type handling) without
 * touching Postgres. `FOR UPDATE SKIP LOCKED`-driven concurrency itself is a
 * real-Postgres-only concern — see `prisma-domain-event.repository.dispatch.integration.spec.ts`.
 */
class FakeDomainEventRepository implements DomainEventRepository {
  constructor(private readonly events: DomainEventRecord[]) {}

  record(): Promise<DomainEventRecord> {
    throw new Error('not used by these tests');
  }

  async dispatchNextPending(
    handler: (event: DomainEventRecord) => Promise<DomainEventDispatchDecision>,
  ): Promise<DomainEventDispatchResult | null> {
    const pending = this.events
      .filter((event) => event.status === 'pending')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const claimed = pending[0];
    if (!claimed) {
      return null;
    }

    const decision = await handler(claimed);

    if (decision.outcome === 'dispatched') {
      claimed.status = 'dispatched';
      claimed.dispatchedAt = new Date('2026-01-01T00:00:05Z');
    } else if (decision.outcome === 'retry') {
      claimed.dispatchAttempts += 1;
    } else {
      claimed.status = 'failed';
      if (decision.incrementAttempts) {
        claimed.dispatchAttempts += 1;
      }
    }

    return { event: { ...claimed }, decision };
  }
}

function makeRegistry(consumers: DomainEventConsumer[]): DomainEventConsumerRegistry {
  const byType = new Map(consumers.map((consumer) => [consumer.eventType, consumer]));
  return {
    getConsumer: (eventType: DomainEventType) => byType.get(eventType),
  };
}

describe('DispatchDomainEventsUseCase', () => {
  it('claims the pending event and routes it to the consumer registered for its event type', async () => {
    const event = makeEvent();
    const repository = new FakeDomainEventRepository([event]);
    const handle = vi.fn().mockResolvedValue(undefined);
    const consumer: DomainEventConsumer = { eventType: 'TransactionCommitted', handle };
    const registry = makeRegistry([consumer]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    const summary = await useCase.dispatchOne();

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1' }));
    expect(summary?.eventId).toBe('evt-1');
    expect(summary?.eventType).toBe('TransactionCommitted');
  });

  it('a successful consumer results in outcome "dispatched"', async () => {
    const repository = new FakeDomainEventRepository([makeEvent()]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockResolvedValue(undefined) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    const summary = await useCase.dispatchOne();

    expect(summary?.outcome).toBe('dispatched');
  });

  it('dispatchedAt is set only after a successful delivery, never on retry or failure', async () => {
    const successEvent = makeEvent({ id: 'evt-success' });
    const failureEvent = makeEvent({ id: 'evt-failure', eventType: 'TransactionEdited' });

    const successRepo = new FakeDomainEventRepository([successEvent]);
    await new DispatchDomainEventsUseCase(
      successRepo,
      makeRegistry([
        { eventType: 'TransactionCommitted', handle: vi.fn().mockResolvedValue(undefined) },
      ]),
    ).dispatchOne();
    expect(successEvent.dispatchedAt).not.toBeNull();

    const failureRepo = new FakeDomainEventRepository([failureEvent]);
    await new DispatchDomainEventsUseCase(
      failureRepo,
      makeRegistry([
        {
          eventType: 'TransactionEdited',
          handle: vi.fn().mockRejectedValue(new Error('consumer exploded')),
        },
      ]),
    ).dispatchOne();
    expect(failureEvent.dispatchedAt).toBeNull();
  });

  it('a consumer failure retries (stays pending) while dispatch_attempts is below the max', async () => {
    const event = makeEvent();
    const repository = new FakeDomainEventRepository([event]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockRejectedValue(new Error('boom')) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry, 5);

    const summary = await useCase.dispatchOne();

    expect(summary?.outcome).toBe('retry');
    expect(event.status).toBe('pending');
    expect(event.dispatchAttempts).toBe(1);
  });

  it('dispatch_attempts increments by exactly one per failed attempt across repeated retries', async () => {
    const event = makeEvent();
    const repository = new FakeDomainEventRepository([event]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockRejectedValue(new Error('boom')) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry, 10);

    await useCase.dispatchOne();
    expect(event.dispatchAttempts).toBe(1);
    await useCase.dispatchOne();
    expect(event.dispatchAttempts).toBe(2);
    await useCase.dispatchOne();
    expect(event.dispatchAttempts).toBe(3);
  });

  it('the Nth failed attempt (matching DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS) becomes terminally failed', async () => {
    const maxAttempts = 3;
    const event = makeEvent();
    const repository = new FakeDomainEventRepository([event]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockRejectedValue(new Error('boom')) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry, maxAttempts);

    const first = await useCase.dispatchOne();
    expect(first?.outcome).toBe('retry');
    expect(event.status).toBe('pending');

    const second = await useCase.dispatchOne();
    expect(second?.outcome).toBe('retry');
    expect(event.status).toBe('pending');

    const third = await useCase.dispatchOne();
    expect(third?.outcome).toBe('failed');
    expect(event.status).toBe('failed');
    expect(event.dispatchAttempts).toBe(3);
  });

  it('an event type with no registered consumer is marked failed immediately, without ever calling a consumer, and dispatch_attempts is left untouched', async () => {
    const event = makeEvent({ eventType: 'BudgetThresholdCrossed' });
    const repository = new FakeDomainEventRepository([event]);
    const handle = vi.fn();
    // Registry only knows about a different event type — BudgetThresholdCrossed has no consumer.
    const registry = makeRegistry([{ eventType: 'TransactionCommitted', handle }]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    const summary = await useCase.dispatchOne();

    expect(handle).not.toHaveBeenCalled();
    expect(summary?.outcome).toBe('unknown_event_type');
    expect(event.status).toBe('failed');
    expect(event.dispatchAttempts).toBe(0);
  });

  it('an unknown-event-type failure is never retried on a subsequent dispatch cycle', async () => {
    const event = makeEvent({ eventType: 'DebtOverdue' });
    const repository = new FakeDomainEventRepository([event]);
    const registry = makeRegistry([]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    await useCase.dispatchOne();
    expect(event.status).toBe('failed');

    // A second poll cycle must not reclaim it — it is no longer `pending`.
    const second = await useCase.dispatchOne();
    expect(second).toBeNull();
  });

  it('dispatchBatch processes up to batchSize pending events, oldest first', async () => {
    const eventA = makeEvent({ id: 'evt-a', createdAt: new Date('2026-01-01T00:00:02Z') });
    const eventB = makeEvent({ id: 'evt-b', createdAt: new Date('2026-01-01T00:00:01Z') });
    const eventC = makeEvent({ id: 'evt-c', createdAt: new Date('2026-01-01T00:00:03Z') });
    const repository = new FakeDomainEventRepository([eventA, eventB, eventC]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockResolvedValue(undefined) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    const summaries = await useCase.dispatchBatch(2);

    expect(summaries.map((s) => s.eventId)).toEqual(['evt-b', 'evt-a']);
    expect(eventC.status).toBe('pending'); // never claimed — batch size was 2
  });

  it('dispatchBatch stops early (before reaching batchSize) once no pending events remain', async () => {
    const repository = new FakeDomainEventRepository([makeEvent()]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockResolvedValue(undefined) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    const summaries = await useCase.dispatchBatch(50);

    expect(summaries).toHaveLength(1);
  });

  it('an already-dispatched event is never reclaimed by a later dispatchOne call', async () => {
    const event = makeEvent();
    const repository = new FakeDomainEventRepository([event]);
    const registry = makeRegistry([
      { eventType: 'TransactionCommitted', handle: vi.fn().mockResolvedValue(undefined) },
    ]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    await useCase.dispatchOne();
    expect(event.status).toBe('dispatched');

    const second = await useCase.dispatchOne();
    expect(second).toBeNull();
  });

  it('returns null when there is nothing pending to claim', async () => {
    const repository = new FakeDomainEventRepository([]);
    const registry = makeRegistry([]);
    const useCase = new DispatchDomainEventsUseCase(repository, registry);

    expect(await useCase.dispatchOne()).toBeNull();
  });
});

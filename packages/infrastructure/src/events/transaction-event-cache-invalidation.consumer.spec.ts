import { describe, expect, it, vi } from 'vitest';
import type { DomainEventRecord, ReportCacheRepository } from '@afa/domain';

import {
  buildTransactionEventCacheInvalidationConsumers,
  TransactionEventCacheInvalidationConsumer,
} from './transaction-event-cache-invalidation.consumer';

function makeEvent(overrides: Partial<DomainEventRecord> = {}): DomainEventRecord {
  return {
    id: 'evt-1',
    eventType: 'TransactionCommitted',
    payload: {},
    status: 'pending',
    dispatchAttempts: 0,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    dispatchedAt: null,
    ...overrides,
  };
}

function fakeCache(): ReportCacheRepository & { invalidate: ReturnType<typeof vi.fn> } {
  return {
    invalidate: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TransactionEventCacheInvalidationConsumer', () => {
  describe('handleTransactionCommitted', () => {
    it('invalidates the correct cache period for the committed transaction date, scoped to the correct user', async () => {
      const cache = fakeCache();
      const consumer = new TransactionEventCacheInvalidationConsumer(cache);
      const event = makeEvent({
        eventType: 'TransactionCommitted',
        payload: {
          transactionId: 'txn-1',
          userId: 'user-1',
          transactionDate: '2026-01-15T00:00:00Z',
        },
      });

      await consumer.handleTransactionCommitted(event);

      expect(cache.invalidate).toHaveBeenCalledTimes(1);
      const [userId, periods] = cache.invalidate.mock.calls[0]!;
      expect(userId).toBe('user-1');
      expect(periods).toEqual(
        expect.arrayContaining([
          { reportType: 'monthly', periodKey: '2026-01' },
          { reportType: 'yearly', periodKey: '2026' },
        ]),
      );
    });

    it('fails safely (throws, never silently no-ops) on a malformed payload — no cache call occurs', async () => {
      const cache = fakeCache();
      const consumer = new TransactionEventCacheInvalidationConsumer(cache);
      const event = makeEvent({
        eventType: 'TransactionCommitted',
        payload: { transactionId: 'txn-1' }, // missing userId/transactionDate
      });

      await expect(consumer.handleTransactionCommitted(event)).rejects.toThrow(/Malformed/);
      expect(cache.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('handleTransactionEdited', () => {
    it('invalidates BOTH the historical (previous) period and the new period when a backdated edit moves the transaction across periods', async () => {
      const cache = fakeCache();
      const consumer = new TransactionEventCacheInvalidationConsumer(cache);
      const event = makeEvent({
        eventType: 'TransactionEdited',
        payload: {
          transactionId: 'txn-1',
          userId: 'user-1',
          previousTransactionDate: '2024-03-10T00:00:00Z', // two years ago
          newTransactionDate: '2026-01-15T00:00:00Z',
        },
      });

      await consumer.handleTransactionEdited(event);

      const [userId, periods] = cache.invalidate.mock.calls[0]!;
      expect(userId).toBe('user-1');
      expect(periods).toEqual(
        expect.arrayContaining([
          { reportType: 'monthly', periodKey: '2024-03' }, // historical period, not just current
          { reportType: 'yearly', periodKey: '2024' },
          { reportType: 'monthly', periodKey: '2026-01' },
          { reportType: 'yearly', periodKey: '2026' },
        ]),
      );
    });

    it('does not duplicate cache keys when the edit did not change the date (same period both sides)', async () => {
      const cache = fakeCache();
      const consumer = new TransactionEventCacheInvalidationConsumer(cache);
      const event = makeEvent({
        eventType: 'TransactionEdited',
        payload: {
          transactionId: 'txn-1',
          userId: 'user-1',
          previousTransactionDate: '2026-01-15T00:00:00Z',
          newTransactionDate: '2026-01-15T00:00:00Z',
        },
      });

      await consumer.handleTransactionEdited(event);

      const [, periods] = cache.invalidate.mock.calls[0]!;
      expect(periods).toHaveLength(5); // exactly one set of 5 periods, not 10
    });
  });

  describe('handleTransactionDeleted', () => {
    it("invalidates the cache period for the deleted transaction's own date", async () => {
      const cache = fakeCache();
      const consumer = new TransactionEventCacheInvalidationConsumer(cache);
      const event = makeEvent({
        eventType: 'TransactionDeleted',
        payload: {
          transactionId: 'txn-1',
          userId: 'user-1',
          transactionDate: '2026-06-01T00:00:00Z',
        },
      });

      await consumer.handleTransactionDeleted(event);

      const [userId, periods] = cache.invalidate.mock.calls[0]!;
      expect(userId).toBe('user-1');
      expect(periods).toEqual(
        expect.arrayContaining([{ reportType: 'monthly', periodKey: '2026-06' }]),
      );
    });
  });

  describe('idempotent redelivery', () => {
    it('handling the same event twice succeeds both times with no error and no duplicate business effect beyond the cache call itself', async () => {
      const cache = fakeCache();
      const consumer = new TransactionEventCacheInvalidationConsumer(cache);
      const event = makeEvent({
        eventType: 'TransactionCommitted',
        payload: {
          transactionId: 'txn-1',
          userId: 'user-1',
          transactionDate: '2026-01-15T00:00:00Z',
        },
      });

      await expect(consumer.handleTransactionCommitted(event)).resolves.toBeUndefined();
      await expect(consumer.handleTransactionCommitted(event)).resolves.toBeUndefined();

      expect(cache.invalidate).toHaveBeenCalledTimes(2);
      expect(cache.invalidate.mock.calls[0]).toEqual(cache.invalidate.mock.calls[1]);
    });
  });
});

describe('buildTransactionEventCacheInvalidationConsumers', () => {
  it('registers exactly TransactionCommitted, TransactionEdited, and TransactionDeleted, each routed to the matching handler method', async () => {
    const cache = fakeCache();
    const handler = new TransactionEventCacheInvalidationConsumer(cache);
    const spyCommitted = vi
      .spyOn(handler, 'handleTransactionCommitted')
      .mockResolvedValue(undefined);
    const spyEdited = vi.spyOn(handler, 'handleTransactionEdited').mockResolvedValue(undefined);
    const spyDeleted = vi.spyOn(handler, 'handleTransactionDeleted').mockResolvedValue(undefined);

    const consumers = buildTransactionEventCacheInvalidationConsumers(handler);
    expect(consumers.map((c) => c.eventType)).toEqual([
      'TransactionCommitted',
      'TransactionEdited',
      'TransactionDeleted',
    ]);

    const event = makeEvent();
    await consumers[0]!.handle(event);
    await consumers[1]!.handle(event);
    await consumers[2]!.handle(event);

    expect(spyCommitted).toHaveBeenCalledWith(event);
    expect(spyEdited).toHaveBeenCalledWith(event);
    expect(spyDeleted).toHaveBeenCalledWith(event);
  });
});

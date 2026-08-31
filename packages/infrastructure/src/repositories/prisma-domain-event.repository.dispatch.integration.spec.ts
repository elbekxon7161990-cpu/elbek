import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DomainEventDispatchDecision } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaDomainEventRepository } from './prisma-domain-event.repository';

/**
 * FR-DB-015 — real-Postgres proof of the dispatcher's claiming/transaction-
 * boundary guarantees, per this task's own §11 instructions: `FOR UPDATE
 * SKIP LOCKED`, concurrent claiming, rollback, and retry persistence must
 * never be faked. `dispatch-domain-events.use-case.spec.ts` already covers
 * the *policy* (consumer routing, retry-vs-terminal threshold, batching) with
 * an in-memory fake repository — this suite covers exactly the part that
 * fake cannot: what Postgres itself actually guarantees.
 *
 * Owner-role connection, matching every other `*.integration.spec.ts` in
 * this package — `DomainEvent` is not RLS-protected (see
 * `prisma-domain-event.repository.ts`'s own doc comment), so this is not an
 * RLS test either way.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

const ALWAYS_DISPATCHED: (event: unknown) => Promise<DomainEventDispatchDecision> = () =>
  Promise.resolve({ outcome: 'dispatched' });

describe('PrismaDomainEventRepository.dispatchNextPending (FR-DB-015, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const repository = new PrismaDomainEventRepository(prisma);

  // Per-test isolation, not per-suite: a test proving the "retry" outcome
  // deliberately leaves its row `status = 'pending'` (that IS the behavior
  // under test), and this table has no per-test namespace to scope a
  // `WHERE` clause by. Without cleaning up after every single test, that
  // leftover pending row survives into the NEXT test and — since claiming
  // is strictly oldest-`created_at`-first — gets silently claimed instead
  // of whatever that next test freshly seeded, corrupting its assertions
  // without ever throwing. Deleting every row this suite created after each
  // test, regardless of the status it ended up in, is what actually
  // guarantees "the next dispatchNextPending call claims MY row."
  let currentTestEventIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterEach(async () => {
    if (currentTestEventIds.length > 0) {
      await prisma.domainEvent.deleteMany({ where: { id: { in: currentTestEventIds } } });
    }
    currentTestEventIds = [];
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function seedEvent(
    overrides: {
      createdAt?: Date;
      dispatchAttempts?: number;
      eventType?: string;
    } = {},
  ): Promise<string> {
    const row = await prisma.domainEvent.create({
      data: {
        eventType: overrides.eventType ?? 'TransactionCommitted',
        payload: { transactionId: randomUUID(), userId: randomUUID() },
        status: 'pending',
        dispatchAttempts: overrides.dispatchAttempts ?? 0,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
    currentTestEventIds.push(row.id);
    return row.id;
  }

  it('claims a pending event, and the claimed record carries the correct shape (payload deserialized, not a JSON string)', async () => {
    const eventId = await seedEvent();

    const result = await repository.dispatchNextPending(ALWAYS_DISPATCHED);

    expect(result).not.toBeNull();
    expect(result!.event.id).toBe(eventId);
    expect(result!.event.status).toBe('pending'); // the pre-update snapshot handler receives
    expect(typeof result!.event.payload).toBe('object');
    expect(result!.event.payload).toHaveProperty('transactionId');
  });

  it('a "dispatched" decision sets status=dispatched and dispatchedAt, leaving dispatchAttempts unchanged', async () => {
    const eventId = await seedEvent();

    await repository.dispatchNextPending(ALWAYS_DISPATCHED);

    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe('dispatched');
    expect(row.dispatchedAt).not.toBeNull();
    expect(row.dispatchAttempts).toBe(0);
  });

  it('an already-dispatched event is never reclaimed by a later call', async () => {
    await seedEvent();
    const first = await repository.dispatchNextPending(ALWAYS_DISPATCHED);
    expect(first).not.toBeNull();

    // Nothing else pending for this call to find (assuming test isolation —
    // each test seeds and cleans its own rows) — proves the dispatched row
    // itself is excluded, not merely "there happened to be nothing else."
    const second = await repository.dispatchNextPending(ALWAYS_DISPATCHED);
    expect(second).toBeNull();
  });

  it('B — a retryable consumer failure leaves the event pending and increments dispatchAttempts by exactly one', async () => {
    const eventId = await seedEvent();

    const result = await repository.dispatchNextPending(() =>
      Promise.resolve({ outcome: 'retry' }),
    );

    expect(result!.decision.outcome).toBe('retry');
    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe('pending');
    expect(row.dispatchAttempts).toBe(1);
    expect(row.dispatchedAt).toBeNull();
  });

  it('C — a terminal failure on what was already the 4th recorded attempt sets status=failed with dispatchAttempts=5', async () => {
    const eventId = await seedEvent({ dispatchAttempts: 4 });

    const result = await repository.dispatchNextPending(() =>
      Promise.resolve({ outcome: 'failed', incrementAttempts: true }),
    );

    expect(result!.event.id).toBe(eventId);
    expect(result!.decision.outcome).toBe('failed');
    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe('failed');
    expect(row.dispatchAttempts).toBe(5);
    expect(row.dispatchedAt).toBeNull();
  });

  it('an unknown-consumer-style terminal failure sets status=failed WITHOUT incrementing dispatchAttempts', async () => {
    const eventId = await seedEvent({ dispatchAttempts: 0 });

    const result = await repository.dispatchNextPending(() =>
      Promise.resolve({ outcome: 'failed', incrementAttempts: false }),
    );

    expect(result!.event.id).toBe(eventId);
    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe('failed');
    expect(row.dispatchAttempts).toBe(0);
  });

  it('D — a handler that throws (simulating a crash before the status update) leaves the event pending, and it is re-claimable on the very next call', async () => {
    const eventId = await seedEvent();

    await expect(
      repository.dispatchNextPending(() => {
        throw new Error('simulated crash mid-dispatch, before any status update');
      }),
    ).rejects.toThrow('simulated crash mid-dispatch');

    const rowAfterCrash = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(rowAfterCrash.status).toBe('pending');
    expect(rowAfterCrash.dispatchAttempts).toBe(0);

    // Re-claimable: a normal, successful call immediately afterward succeeds
    // against the very same row — the earlier aborted transaction released
    // its row lock cleanly.
    const retry = await repository.dispatchNextPending(ALWAYS_DISPATCHED);
    expect(retry!.event.id).toBe(eventId);
    const rowAfterRetry = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(rowAfterRetry.status).toBe('dispatched');
  });

  it('claims strictly in created_at order, oldest pending first', async () => {
    const base = Date.now();
    const idNewest = await seedEvent({ createdAt: new Date(base + 3000) });
    const idOldest = await seedEvent({ createdAt: new Date(base + 1000) });
    const idMiddle = await seedEvent({ createdAt: new Date(base + 2000) });

    const first = await repository.dispatchNextPending(ALWAYS_DISPATCHED);
    const second = await repository.dispatchNextPending(ALWAYS_DISPATCHED);
    const third = await repository.dispatchNextPending(ALWAYS_DISPATCHED);

    expect([first!.event.id, second!.event.id, third!.event.id]).toEqual([
      idOldest,
      idMiddle,
      idNewest,
    ]);
  });

  it('processes only up to the caller-controlled number of claims — the rest remain pending for the next cycle', async () => {
    const idA = await seedEvent();
    const idB = await seedEvent();
    const idC = await seedEvent();

    // Simulates DOMAIN_EVENT_BATCH_SIZE = 2: exactly two claim calls.
    await repository.dispatchNextPending(ALWAYS_DISPATCHED);
    await repository.dispatchNextPending(ALWAYS_DISPATCHED);

    const rows = await prisma.domainEvent.findMany({
      where: { id: { in: [idA, idB, idC] } },
    });
    const dispatchedCount = rows.filter((row) => row.status === 'dispatched').length;
    const pendingCount = rows.filter((row) => row.status === 'pending').length;
    expect(dispatchedCount).toBe(2);
    expect(pendingCount).toBe(1);
  });

  it('A — two genuinely concurrent dispatchers claiming against a single pending event: exactly one succeeds, the other finds nothing (real Promise.all concurrency, no serialization by the test itself)', async () => {
    const eventId = await seedEvent();
    let handlerInvocations = 0;
    const countingHandler = () => {
      handlerInvocations += 1;
      return Promise.resolve<DomainEventDispatchDecision>({ outcome: 'dispatched' });
    };

    const [resultA, resultB] = await Promise.all([
      repository.dispatchNextPending(countingHandler),
      repository.dispatchNextPending(countingHandler),
    ]);

    const nonNullResults = [resultA, resultB].filter((r) => r !== null);
    expect(nonNullResults).toHaveLength(1);
    expect(handlerInvocations).toBe(1);
    expect(nonNullResults[0]!.event.id).toBe(eventId);

    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe('dispatched');
  });

  it('A2 — five genuinely concurrent dispatchers against five distinct pending events: each event dispatched exactly once, no event skipped, no event double-claimed', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => seedEvent()));
    let handlerInvocations = 0;
    const countingHandler = () => {
      handlerInvocations += 1;
      return Promise.resolve<DomainEventDispatchDecision>({ outcome: 'dispatched' });
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => repository.dispatchNextPending(countingHandler)),
    );

    const claimedIds = results.map((r) => r?.event.id).filter((id): id is string => Boolean(id));
    expect(new Set(claimedIds).size).toBe(5); // no duplicate claims across the 5 concurrent callers
    expect(claimedIds.sort()).toEqual([...ids].sort());
    expect(handlerInvocations).toBe(5);

    const rows = await prisma.domainEvent.findMany({ where: { id: { in: ids } } });
    expect(rows.every((row) => row.status === 'dispatched')).toBe(true);
  });
});

describe('PrismaDomainEventRepository.dispatchNextPending — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('FR-DB-015 dispatch integration environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

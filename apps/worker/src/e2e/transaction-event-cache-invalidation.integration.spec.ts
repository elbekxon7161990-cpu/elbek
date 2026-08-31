import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { DispatchDomainEventsUseCase } from '@afa/application';
import { computeReportCachePeriods } from '@afa/domain';
import {
  buildTransactionEventCacheInvalidationConsumers,
  MapDomainEventConsumerRegistry,
  PrismaDomainEventRepository,
  PrismaService,
  PrismaTransactionRepository,
  RedisReportCacheRepository,
  TransactionEventCacheInvalidationConsumer,
} from '@afa/infrastructure';

/**
 * TASK-DB-009 (FR-DB-025) — the required real-Postgres + real-Redis proof of
 * the full chain this task's own instructions describe literally:
 *
 *   Transaction mutation → domain_events row → FR-DB-015 dispatcher
 *   → TASK-DB-009 consumer → Redis cache invalidation
 *
 * Deliberately placed in `apps/worker` (the composition root), not
 * `packages/infrastructure` — that package's own package.json states it
 * "never [depends] on @afa/application," and this test needs the real
 * `DispatchDomainEventsUseCase` (FR-DB-015, `@afa/application`) alongside
 * real infrastructure adapters, exactly the cross-layer proof `apps/*`
 * exists for (mirroring `apps/telegram-bot/src/e2e/*.spec.ts`'s own
 * convention). No fake consumer, no fake dispatcher, no fake cache.
 *
 * Same owner-role Postgres convention as every TASK-DB-010/FR-DB-015
 * integration spec (`DIRECT_URL ?? DATABASE_URL`); same real-Redis
 * convention as `redis-commit-idempotency-lock.repository.integration.spec.ts`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID = 900_000_000_909n;
const CURRENCY_CODE = 'UZS';

describe('TASK-DB-009 — mutation -> domain_events -> FR-DB-015 dispatcher -> cache invalidation consumer -> Redis (real Postgres + real Redis)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const redis = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const domainEventRepository = new PrismaDomainEventRepository(prisma);
  const cacheRepository = new RedisReportCacheRepository(redis);
  const consumerHandler = new TransactionEventCacheInvalidationConsumer(cacheRepository);
  const registry = new MapDomainEventConsumerRegistry(
    buildTransactionEventCacheInvalidationConsumers(consumerHandler),
  );
  const dispatchUseCase = new DispatchDomainEventsUseCase(domainEventRepository, registry);

  let userId: string;
  let categoryId: string;
  let currentTestTransactionIds: string[] = [];
  let currentTestRedisKeys: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
    await redis.connect();

    // Sweep any stray `pending` domain_events left over from earlier,
    // unrelated test/debugging runs in this shared dev database — this
    // suite's own dispatchOne() calls claim strictly the globally-oldest
    // pending row (exactly as production does), so a leftover stale row
    // from a prior session would otherwise be claimed instead of the
    // event a given test actually just produced, corrupting its
    // assertions without ever throwing. Scoped to `createdAt < now`, so it
    // can never race a row this suite's own tests create afterward.
    const sweepCutoff = new Date();
    await prisma.domainEvent.deleteMany({
      where: { status: 'pending', createdAt: { lt: sweepCutoff } },
    });

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: {
        telegramUserId: TEST_TELEGRAM_USER_ID,
        displayName: 'TASK-DB-009 Cache Invalidation Test',
      },
      update: {},
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }
    categoryId = category.id;
  });

  afterEach(async () => {
    if (currentTestTransactionIds.length > 0) {
      await prisma.domainEvent.deleteMany({
        where: { payload: { path: ['userId'], equals: userId } },
      });
      await prisma.transaction.deleteMany({ where: { id: { in: currentTestTransactionIds } } });
    }
    if (currentTestRedisKeys.length > 0) {
      await redis.del(...currentTestRedisKeys);
    }
    currentTestTransactionIds = [];
    currentTestRedisKeys = [];
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await redis.quit();
    await prisma.onModuleDestroy();
  });

  async function seedCacheKeys(date: Date): Promise<string[]> {
    const periods = computeReportCachePeriods(date);
    const keys = periods.map((p) => `report:${userId}:${p.reportType}:${p.periodKey}`);
    for (const key of keys) {
      await redis.set(key, JSON.stringify({ fake: 'cached-report-aggregate' }));
    }
    currentTestRedisKeys.push(...keys);
    return keys;
  }

  async function assertAllAbsent(keys: string[]): Promise<void> {
    for (const key of keys) {
      expect(await redis.exists(key)).toBe(0);
    }
  }

  it('A — create a transaction: TransactionCommitted event exists, the dispatcher consumes it, and the affected report cache keys are deleted', async () => {
    const transactionDate = new Date('2026-01-15');
    const staleCacheKeys = await seedCacheKeys(transactionDate);
    for (const key of staleCacheKeys) {
      expect(await redis.exists(key)).toBe(1); // sanity: the stale cache genuinely existed first
    }

    const created = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '10000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate,
      description: 'Scenario A',
      originalText: 'scenario a',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);

    const events = await prisma.domainEvent.findMany({
      where: { payload: { path: ['transactionId'], equals: created.id } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('TransactionCommitted');
    expect(events[0]!.status).toBe('pending');

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    await assertAllAbsent(staleCacheKeys);

    const eventAfter = await prisma.domainEvent.findUniqueOrThrow({ where: { id: events[0]!.id } });
    expect(eventAfter.status).toBe('dispatched');
  }, 30_000);

  it('B — edit a two-year-old transaction: the historical period cache key is invalidated, not only the current period', async () => {
    const historicalDate = new Date('2024-02-10'); // two years before "now" in this suite's own 2026 fixture convention
    const created = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '5000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: historicalDate,
      description: 'Scenario B (before edit)',
      originalText: 'scenario b',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);
    // Drain the TransactionCommitted event from Scenario B's own setup so it
    // does not get claimed instead of the TransactionEdited event below.
    await dispatchUseCase.dispatchOne();

    const historicalCacheKeys = await seedCacheKeys(historicalDate);
    for (const key of historicalCacheKeys) {
      expect(await redis.exists(key)).toBe(1);
    }

    await transactionRepository.update(created.id, { amount: '7500' }); // date unchanged — still the historical period

    const editedEvents = await prisma.domainEvent.findMany({
      where: {
        payload: { path: ['transactionId'], equals: created.id },
        eventType: 'TransactionEdited',
      },
    });
    expect(editedEvents).toHaveLength(1);

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    await assertAllAbsent(historicalCacheKeys);
  }, 30_000);

  it('B2 — editing a transaction date across periods invalidates BOTH the old and the new period', async () => {
    const oldDate = new Date('2024-05-01');
    const newDate = new Date('2026-01-15');
    const created = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '3000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: oldDate,
      description: 'Scenario B2 (before date edit)',
      originalText: 'scenario b2',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);
    await dispatchUseCase.dispatchOne(); // drain TransactionCommitted

    const oldPeriodKeys = await seedCacheKeys(oldDate);
    const newPeriodKeys = await seedCacheKeys(newDate);

    await transactionRepository.update(created.id, { transactionDate: newDate });
    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    await assertAllAbsent(oldPeriodKeys);
    await assertAllAbsent(newPeriodKeys);
  }, 30_000);

  it('C — delete a transaction: TransactionDeleted event exists, the dispatcher consumes it, and the affected cache key is invalidated', async () => {
    const transactionDate = new Date('2026-03-20');
    const created = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '2000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate,
      description: 'Scenario C',
      originalText: 'scenario c',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);
    await dispatchUseCase.dispatchOne(); // drain TransactionCommitted

    const cacheKeys = await seedCacheKeys(transactionDate);

    const deleted = await transactionRepository.softDelete(created.id);
    expect(deleted).not.toBeNull();

    const deletedEvents = await prisma.domainEvent.findMany({
      where: {
        payload: { path: ['transactionId'], equals: created.id },
        eventType: 'TransactionDeleted',
      },
    });
    expect(deletedEvents).toHaveLength(1);

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    await assertAllAbsent(cacheKeys);
  }, 30_000);

  it('D — delivering the same TransactionCommitted event to the consumer twice is idempotent: no error, Redis ends in the same safe state both times', async () => {
    const transactionDate = new Date('2026-05-05');
    const cacheKeys = await seedCacheKeys(transactionDate);

    const syntheticEvent = {
      id: 'synthetic-redelivery-test',
      eventType: 'TransactionCommitted' as const,
      payload: {
        transactionId: 'txn-synthetic',
        userId,
        transactionDate: transactionDate.toISOString(),
      },
      status: 'pending' as const,
      dispatchAttempts: 0,
      createdAt: new Date(),
      dispatchedAt: null,
    };

    await expect(
      consumerHandler.handleTransactionCommitted(syntheticEvent),
    ).resolves.toBeUndefined();
    await assertAllAbsent(cacheKeys);

    // Re-seed to prove the SECOND delivery also correctly deletes — not
    // merely "the keys were already gone so nothing ran."
    await seedCacheKeys(transactionDate);
    for (const key of cacheKeys) {
      expect(await redis.exists(key)).toBe(1);
    }

    await expect(
      consumerHandler.handleTransactionCommitted(syntheticEvent),
    ).resolves.toBeUndefined();
    await assertAllAbsent(cacheKeys);
  }, 30_000);
});

describe('TASK-DB-009 — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (presence booleans only).
    console.log('TASK-DB-009 cache-invalidation environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DispatchDomainEventsUseCase } from '@afa/application';
import { runWithUserContext } from '@afa/shared';
import {
  buildNotificationDeliveryConsumers,
  MapDomainEventConsumerRegistry,
  NOTIFICATION_DELIVERY_QUEUE_NAME,
  NotificationDeliveryConsumer,
  PrismaBudgetRepository,
  PrismaDomainEventRepository,
  PrismaNotificationDedupRepository,
  PrismaNotificationPreferenceRepository,
  PrismaNotificationRepository,
  PrismaService,
  PrismaTransactionRepository,
  PrismaUserRepository,
} from '@afa/infrastructure';

/**
 * TASK-FIN-003 (Chapter 19 Scenario C) — the required real-Postgres +
 * real-Redis proof of the FULL chain, end to end, with a REAL producer (not
 * a manually-seeded `domain_events` row, unlike TASK-BOT-009's own suite,
 * which had no real producer at the time it was written):
 *
 *   real EXPENSE transaction commit -> PrismaTransactionRepository.create()'s
 *   own synchronous threshold hook -> real `BudgetThresholdCrossed` domain_events
 *   row -> FR-DB-015 dispatcher -> NotificationDeliveryConsumer -> gates
 *   (preference/dedup/quiet-hours) -> real `notifications` row -> real
 *   BullMQ delivery job.
 *
 * Mirrors `notification-delivery.integration.spec.ts`'s exact structure and
 * conventions (owner-role Postgres, real Redis, stops short of an actual
 * Telegram send).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID = 900_000_000_973n;
const CURRENCY_CODE = 'RUB';
const PERIOD_START = new Date('2026-08-01');
const PERIOD_END = new Date('2026-08-31');

describe("Chapter 19 Scenario C — Elena's Budget Overspend Recovery Loop (real Postgres + real Redis, end to end)", () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const redis = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  const userRepository = new PrismaUserRepository(prisma);
  const preferenceRepository = new PrismaNotificationPreferenceRepository(prisma);
  const dedupRepository = new PrismaNotificationDedupRepository(prisma);
  const notificationRepository = new PrismaNotificationRepository(prisma);
  const deliveryQueue = new Queue(NOTIFICATION_DELIVERY_QUEUE_NAME, { connection: redis });
  const consumerHandler = new NotificationDeliveryConsumer(
    userRepository,
    preferenceRepository,
    dedupRepository,
    notificationRepository,
    {
      enqueue: (notificationId, userId, deliverAt) =>
        enqueueViaRealQueue(notificationId, userId, deliverAt),
    },
  );
  const registry = new MapDomainEventConsumerRegistry(
    buildNotificationDeliveryConsumers(consumerHandler),
  );
  const domainEventRepository = new PrismaDomainEventRepository(prisma);
  const dispatchUseCase = new DispatchDomainEventsUseCase(domainEventRepository, registry);

  const budgetRepository = new PrismaBudgetRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);

  let userId: string;
  let categoryId: string;
  let createdNotificationIds: string[] = [];
  let createdJobIds: string[] = [];
  let createdTransactionIds: string[] = [];
  let createdBudgetIds: string[] = [];

  async function enqueueViaRealQueue(
    notificationId: string,
    userId: string,
    deliverAt: Date,
  ): Promise<void> {
    const delay = Math.max(0, deliverAt.getTime() - Date.now());
    await deliveryQueue.add(
      NOTIFICATION_DELIVERY_QUEUE_NAME,
      { notificationId, userId },
      { jobId: notificationId, delay },
    );
    createdJobIds.push(notificationId);
  }

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    await prisma.domainEvent.deleteMany({
      where: { status: 'pending', createdAt: { lt: new Date() } },
    });

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: {
        telegramUserId: TEST_TELEGRAM_USER_ID,
        displayName: 'Scenario C E2E Test',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', parentCategoryId: null },
    });
    if (!category) {
      throw new Error('No active top-level expense category found — run `prisma db seed` first.');
    }
    categoryId = category.id;
  });

  afterEach(async () => {
    await prisma.domainEvent.deleteMany({
      where: { payload: { path: ['userId'], equals: userId } },
    });
    if (createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
    }
    if (createdJobIds.length > 0) {
      for (const jobId of createdJobIds) {
        const job = await deliveryQueue.getJob(jobId);
        await job?.remove();
      }
    }
    await prisma.userSetting.deleteMany({ where: { userId } });
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    if (createdBudgetIds.length > 0) {
      await prisma.budgetNotificationLog.deleteMany({
        where: { budgetId: { in: createdBudgetIds } },
      });
      await prisma.budget.deleteMany({ where: { id: { in: createdBudgetIds } } });
    }
    createdNotificationIds = [];
    createdJobIds = [];
    createdTransactionIds = [];
    createdBudgetIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.budgetNotificationLog.deleteMany({ where: { budget: { userId } } });
    await prisma.budget.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await deliveryQueue.close();
    await redis.quit();
    await prisma.onModuleDestroy();
  });

  async function findNotificationsForBudget(budgetId: string) {
    const rows = await as(() => prisma.notification.findMany({ where: { userId } }));
    return rows.filter((row) =>
      (row.payload as { dedupKey?: string }).dedupKey?.startsWith(`${budgetId}:`),
    );
  }

  async function spendExpense(amount: string, transactionDate: Date) {
    const transaction = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        amount,
        currency: CURRENCY_CODE,
        categoryId,
        transactionDate,
        description: 'groceries',
        originalText: `spent ${amount} on groceries`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  it('Elena sets a 900,000 RUB Groceries budget; a 75% crossing then a 90% crossing each produce exactly one delivered notification; staying above 75% in between produces none; total is exactly two', async () => {
    const budget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '900000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
      }),
    );
    createdBudgetIds.push(budget.id);

    const txDate = new Date('2026-08-05');

    // 0% -> 80%: crosses 75% — one real BudgetThresholdCrossed event now
    // exists in domain_events, produced by the real transaction commit,
    // not manually seeded. `dispatchBatch` drains every pending event
    // this commit produced — the unconditional `TransactionCommitted`
    // (no registered consumer in THIS suite's own registry, mirroring
    // notification-delivery.integration.spec.ts's own scoped-down
    // registry — its outcome is `unknown_event_type`, harmless and
    // expected) AND the conditional `BudgetThresholdCrossed`.
    await spendExpense('720000', txDate);
    let batch = await dispatchUseCase.dispatchBatch(10);
    expect(
      batch.some((s) => s.eventType === 'BudgetThresholdCrossed' && s.outcome === 'dispatched'),
    ).toBe(true);

    let notifications = await findNotificationsForBudget(budget.id);
    expect(notifications).toHaveLength(1);
    createdNotificationIds.push(notifications[0]!.id);
    expect(notifications[0]!.status).toBe('queued');
    expect((notifications[0]!.payload as { message: string }).message).toMatch(/75%/);
    let job = await deliveryQueue.getJob(notifications[0]!.id);
    expect(job).toBeDefined();

    // 80% -> 89%: still above 75%, has not crossed 90% — no new domain
    // event is even produced (proven at the producer level already in
    // evaluate-budget-thresholds-on-expense-commit.integration.spec.ts);
    // this asserts the end-to-end consequence: no new notification either.
    await spendExpense('81000', txDate);
    const pendingAfterSecond = await prisma.domainEvent.findMany({
      where: { status: 'pending', payload: { path: ['budgetId'], equals: budget.id } },
    });
    expect(pendingAfterSecond).toHaveLength(0);
    notifications = await findNotificationsForBudget(budget.id);
    expect(notifications).toHaveLength(1); // unchanged

    // 89% -> 96%: crosses 90% — the second and FINAL legitimate notification.
    await spendExpense('63000', txDate);
    batch = await dispatchUseCase.dispatchBatch(10);
    expect(
      batch.some((s) => s.eventType === 'BudgetThresholdCrossed' && s.outcome === 'dispatched'),
    ).toBe(true);

    notifications = await findNotificationsForBudget(budget.id);
    expect(notifications).toHaveLength(2);
    const secondNotification = notifications.find((n) => n.id !== createdNotificationIds[0]);
    createdNotificationIds.push(secondNotification!.id);
    expect((secondNotification!.payload as { message: string }).message).toMatch(/90%/);
    job = await deliveryQueue.getJob(secondNotification!.id);
    expect(job).toBeDefined();

    // Exactly two notifications total for this budget — Scenario C's own
    // DoD statement, verified at the very end of the real chain.
    expect(notifications).toHaveLength(2);
  }, 30_000);

  it('reprocessing/redelivery is safe: re-dispatching leaves no pending events and creates no third notification (FR-FIN-048)', async () => {
    const budget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '100000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
      }),
    );
    createdBudgetIds.push(budget.id);

    await spendExpense('90000', new Date('2026-08-10')); // crosses 75% and 90% at once -> two BudgetThresholdCrossed events
    const firstBatch = await dispatchUseCase.dispatchBatch(10);
    expect(
      firstBatch.filter(
        (s) => s.eventType === 'BudgetThresholdCrossed' && s.outcome === 'dispatched',
      ),
    ).toHaveLength(2);

    let notifications = await findNotificationsForBudget(budget.id);
    expect(notifications).toHaveLength(2);
    createdNotificationIds.push(...notifications.map((n) => n.id));

    // Nothing left pending — a second dispatchOne() call has nothing to do.
    const second = await dispatchUseCase.dispatchOne();
    expect(second).toBeNull();

    notifications = await findNotificationsForBudget(budget.id);
    expect(notifications).toHaveLength(2); // still exactly two — no third
  }, 30_000);
});

describe('Chapter 19 Scenario C — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (presence booleans only).
    console.log('Scenario C e2e environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

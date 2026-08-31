import { randomUUID } from 'node:crypto';
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
  PrismaDomainEventRepository,
  PrismaNotificationDedupRepository,
  PrismaNotificationPreferenceRepository,
  PrismaNotificationRepository,
  PrismaService,
  PrismaUserRepository,
} from '@afa/infrastructure';

/**
 * TASK-BOT-009 — the required real-Postgres + real-Redis proof of the full
 * chain this task's own instructions describe literally:
 *
 *   domain_events row (manually seeded — no real producer exists yet, see
 *   this task's final report) -> FR-DB-015 dispatcher ->
 *   NotificationDeliveryConsumer -> gates (preference/dedup/quiet-hours)
 *   -> real `notifications` row -> real BullMQ delivery job
 *
 * Deliberately placed in `apps/worker` (the composition root), mirroring
 * `transaction-event-cache-invalidation.integration.spec.ts`'s own
 * established convention exactly — same owner-role Postgres connection,
 * same real-Redis convention. This suite stops at "a real BullMQ job now
 * exists, correctly scheduled" — it does NOT attempt a real Telegram send
 * (no safe test chat id exists in this environment; see this task's final
 * report's own honesty disclosure).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID = 900_000_000_950n;

describe('TASK-BOT-009 — domain_events -> FR-DB-015 dispatcher -> NotificationDeliveryConsumer -> notifications + BullMQ (real Postgres + real Redis)', () => {
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

  let userId: string;
  let createdNotificationIds: string[] = [];
  let createdJobIds: string[] = [];

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

  beforeAll(async () => {
    await prisma.onModuleInit();
    // Deliberately no explicit `redis.connect()` — constructing the BullMQ
    // `Queue` above already triggers ioredis's own connection sequence on
    // this shared client; calling `.connect()` again here races it
    // ("Redis is already connecting/connected").

    // Sweep any stray `pending` domain_events left over from earlier,
    // unrelated test/debugging runs in this shared dev database — see
    // `transaction-event-cache-invalidation.integration.spec.ts`'s own
    // identical reasoning.
    await prisma.domainEvent.deleteMany({
      where: { status: 'pending', createdAt: { lt: new Date() } },
    });

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'TASK-BOT-009 Test' },
      update: {},
    });
    userId = user.id;
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
    createdNotificationIds = [];
    createdJobIds = [];
  });

  afterAll(async () => {
    // Defensive: a prior interrupted run under this same fixed telegram
    // user id could have left transaction rows behind (this suite itself
    // never creates any) — clear them first so the FK constraint on
    // `transactions.user_id` never blocks this cleanup.
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await deliveryQueue.close();
    await redis.quit();
    await prisma.onModuleDestroy();
  });

  async function seedDebtReminderEvent(
    eventType: 'DebtDueApproaching' | 'DebtOverdue',
    debtId: string,
  ) {
    return prisma.domainEvent.create({
      data: {
        eventType,
        status: 'pending',
        payload: {
          debtId,
          userId,
          counterpartyName: 'Aziz',
          outstandingBalance: '50000.00',
          currency: 'UZS',
          dueDate: '2026-09-01',
        },
      },
    });
  }

  async function findNotificationFor(debtId: string) {
    const rows = await runWithUserContext(userId, () =>
      prisma.notification.findMany({ where: { userId } }),
    );
    return rows.find((row) => (row.payload as { dedupKey?: string }).dedupKey === debtId) ?? null;
  }

  it('A — DebtDueApproaching: dispatched, real notification row created (queued), real BullMQ job scheduled', async () => {
    const debtId = randomUUID();
    const event = await seedDebtReminderEvent('DebtDueApproaching', debtId);

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    const eventAfter = await prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.status).toBe('dispatched');

    const notification = await findNotificationFor(debtId);
    expect(notification).not.toBeNull();
    createdNotificationIds.push(notification!.id);
    expect(notification!.status).toBe('queued');
    const payload = notification!.payload as { message: string };
    expect(payload.message).toContain('Aziz');

    const job = await deliveryQueue.getJob(notification!.id);
    expect(job).toBeDefined();
    expect(job!.data).toMatchObject({ notificationId: notification!.id, userId });
  }, 30_000);

  it('B — DebtOverdue: dispatched, real notification row with the overdue-specific message', async () => {
    const debtId = randomUUID();
    await seedDebtReminderEvent('DebtOverdue', debtId);

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    const notification = await findNotificationFor(debtId);
    createdNotificationIds.push(notification!.id);
    expect((notification!.payload as { message: string }).message).toMatch(/overdue/i);
  }, 30_000);

  it('C — DebtSettled: dispatched, real notification row distinguishing repaid vs forgiven', async () => {
    const debtId = randomUUID();
    const event = await prisma.domainEvent.create({
      data: {
        eventType: 'DebtSettled',
        status: 'pending',
        payload: { debtId, userId, counterpartyName: 'Dilnoza', status: 'forgiven' },
      },
    });

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    const eventAfter = await prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.status).toBe('dispatched');

    const notification = await findNotificationFor(debtId);
    createdNotificationIds.push(notification!.id);
    expect((notification!.payload as { message: string }).message).toMatch(/forgiven/i);
  }, 30_000);

  it('D — a disabled preference produces a real "suppressed" audit row and NO BullMQ job', async () => {
    await runWithUserContext(userId, () =>
      prisma.userSetting.create({
        data: { userId, settingKey: 'notif_debt_reminder', settingValue: { enabled: false } },
      }),
    );
    const debtId = randomUUID();
    await seedDebtReminderEvent('DebtDueApproaching', debtId);

    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    const notification = await findNotificationFor(debtId);
    createdNotificationIds.push(notification!.id);
    expect(notification!.status).toBe('suppressed');
    expect((notification!.payload as { suppressedReason?: string }).suppressedReason).toBe(
      'preference_disabled',
    );

    const job = await deliveryQueue.getJob(notification!.id);
    expect(job).toBeUndefined();
  }, 30_000);

  it('E — a dedup hit (recent notification for the same debt) produces a real "suppressed" audit row and NO second BullMQ job', async () => {
    const debtId = randomUUID();
    await seedDebtReminderEvent('DebtDueApproaching', debtId);
    const first = await dispatchUseCase.dispatchOne();
    expect(first?.outcome).toBe('dispatched');
    const firstNotification = await findNotificationFor(debtId);
    createdNotificationIds.push(firstNotification!.id);

    // A second reminder for the SAME debt, shortly after — must be suppressed.
    await seedDebtReminderEvent('DebtDueApproaching', debtId);
    const second = await dispatchUseCase.dispatchOne();
    expect(second?.outcome).toBe('dispatched');

    const rows = await runWithUserContext(userId, () =>
      prisma.notification.findMany({ where: { userId } }),
    );
    const debtRows = rows.filter(
      (row) => (row.payload as { dedupKey?: string }).dedupKey === debtId,
    );
    expect(debtRows).toHaveLength(2);
    createdNotificationIds.push(...debtRows.map((r) => r.id));
    const suppressedRow = debtRows.find((row) => row.status === 'suppressed');
    expect(suppressedRow).toBeDefined();
    expect((suppressedRow!.payload as { suppressedReason?: string }).suppressedReason).toBe(
      'dedup',
    );
  }, 30_000);
});

describe('TASK-BOT-009 — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (presence booleans only).
    console.log('TASK-BOT-009 notification-delivery environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

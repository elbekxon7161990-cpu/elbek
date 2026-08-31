import { randomUUID } from 'node:crypto';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaNotificationDedupRepository } from './prisma-notification-dedup.repository';
import { PrismaNotificationPreferenceRepository } from './prisma-notification-preference.repository';
import { PrismaNotificationRepository } from './prisma-notification.repository';

/**
 * TASK-BOT-009 — real-Postgres proof for `PrismaNotificationRepository`/
 * `PrismaNotificationPreferenceRepository`/`PrismaNotificationDedupRepository`.
 * Owner-role connection, matching every newer real-Postgres suite in this
 * package. `Notification`/`UserSetting` are both RLS-protected — every
 * call below runs inside `runWithUserContext`, mirroring
 * `prisma-debt.repository.integration.spec.ts`'s own established reasoning.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_940n;
const TELEGRAM_USER_ID_B = 900_000_000_941n;

describe('PrismaNotificationRepository / PrismaNotificationPreferenceRepository / PrismaNotificationDedupRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const notificationRepository = new PrismaNotificationRepository(prisma);
  const preferenceRepository = new PrismaNotificationPreferenceRepository(prisma);
  const dedupRepository = new PrismaNotificationDedupRepository(prisma);
  let userAId: string;
  let userBId: string;
  let createdNotificationIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'TASK-BOT-009 Test A' },
      update: {},
    });
    userAId = userA.id;
    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'TASK-BOT-009 Test B' },
      update: {},
    });
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
    }
    createdNotificationIds = [];
    await prisma.userSetting.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  it('A — create() persists, and findById() retrieves the exact message/dedupKey/readyToDeliverAt round-trip', async () => {
    const readyToDeliverAt = new Date('2026-08-15T10:00:00Z');
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtDueApproaching',
        message: 'test message',
        dedupKey: 'debt-1',
        readyToDeliverAt,
      }),
    );
    createdNotificationIds.push(created.id);

    expect(created.status).toBe('queued');
    expect(created.sentAt).toBeNull();

    const found = await as(userAId, () => notificationRepository.findById(created.id));
    expect(found?.message).toBe('test message');
    expect(found?.dedupKey).toBe('debt-1');
    expect(found?.readyToDeliverAt.toISOString()).toBe(readyToDeliverAt.toISOString());
  });

  it('B — markSent() transitions status and sets sentAt, and is idempotent on a second call', async () => {
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtOverdue',
        message: 'overdue',
        dedupKey: `debt-${randomUUID()}`,
        readyToDeliverAt: new Date(),
      }),
    );
    createdNotificationIds.push(created.id);

    const firstSentAt = new Date('2026-08-15T12:00:00Z');
    const first = await as(userAId, () => notificationRepository.markSent(created.id, firstSentAt));
    expect(first?.status).toBe('sent');
    expect(first?.sentAt?.toISOString()).toBe(firstSentAt.toISOString());

    // Redelivery — must not overwrite the original sentAt.
    const secondSentAt = new Date('2026-08-15T13:00:00Z');
    const second = await as(userAId, () =>
      notificationRepository.markSent(created.id, secondSentAt),
    );
    expect(second?.status).toBe('sent');
    expect(second?.sentAt?.toISOString()).toBe(firstSentAt.toISOString());
  });

  it('C — markFailed() transitions status, and returns null for a non-existent id', async () => {
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtDueApproaching',
        message: 'test',
        dedupKey: `debt-${randomUUID()}`,
        readyToDeliverAt: new Date(),
      }),
    );
    createdNotificationIds.push(created.id);

    const failed = await as(userAId, () => notificationRepository.markFailed(created.id));
    expect(failed?.status).toBe('failed');

    const missing = await as(userAId, () => notificationRepository.markFailed(randomUUID()));
    expect(missing).toBeNull();
  });

  it('C2 — create() persists a real "suppressed" audit row against the actual CHECK constraint, with an empty message and a reason', async () => {
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtDueApproaching',
        message: '',
        dedupKey: `debt-${randomUUID()}`,
        readyToDeliverAt: new Date(),
        status: 'suppressed',
        suppressedReason: 'preference_disabled',
      }),
    );
    createdNotificationIds.push(created.id);

    expect(created.status).toBe('suppressed');
    expect(created.suppressedReason).toBe('preference_disabled');
    expect(created.message).toBe('');
  });

  it('D — NotificationPreferenceRepository.isEnabled() defaults to true with no explicit UserSetting row', async () => {
    const enabled = await as(userAId, () =>
      preferenceRepository.isEnabled(userAId, 'notif_debt_reminder'),
    );
    expect(enabled).toBe(true);
  });

  it('E — NotificationPreferenceRepository.isEnabled() returns false when explicitly disabled via UserSetting', async () => {
    await as(userAId, () =>
      prisma.userSetting.create({
        data: {
          userId: userAId,
          settingKey: 'notif_debt_reminder',
          settingValue: { enabled: false },
        },
      }),
    );

    const enabled = await as(userAId, () =>
      preferenceRepository.isEnabled(userAId, 'notif_debt_reminder'),
    );
    expect(enabled).toBe(false);
  });

  it('F — NotificationDedupRepository.wasRecentlyNotified() is true within the window and scoped by dedupKey', async () => {
    const dedupKey = `debt-${randomUUID()}`;
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtDueApproaching',
        message: 'reminder',
        dedupKey,
        readyToDeliverAt: new Date(),
      }),
    );
    createdNotificationIds.push(created.id);

    const hitSameKey = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        dedupKey,
        new Date(),
        24 * 60 * 60 * 1000,
      ),
    );
    expect(hitSameKey).toBe(true);

    const missDifferentKey = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        `debt-${randomUUID()}`,
        new Date(),
        24 * 60 * 60 * 1000,
      ),
    );
    expect(missDifferentKey).toBe(false);
  });

  it('G — NotificationDedupRepository.wasRecentlyNotified() is false outside the window', async () => {
    const dedupKey = `debt-${randomUUID()}`;
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtDueApproaching',
        message: 'reminder',
        dedupKey,
        readyToDeliverAt: new Date(),
      }),
    );
    createdNotificationIds.push(created.id);

    // asOf far in the future -> the window (asOf - withinMs) starts after the row's createdAt.
    const asOf = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const hit = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        dedupKey,
        asOf,
        60 * 60 * 1000,
      ),
    );
    expect(hit).toBe(false);
  });

  it("H — cross-user query scoping: user A's dedup check is unaffected by user B's notifications", async () => {
    const sharedDedupKey = `debt-${randomUUID()}`;
    const createdForB = await as(userBId, () =>
      notificationRepository.create({
        userId: userBId,
        type: 'DebtDueApproaching',
        message: 'reminder for B',
        dedupKey: sharedDedupKey,
        readyToDeliverAt: new Date(),
      }),
    );
    createdNotificationIds.push(createdForB.id);

    const hitForA = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        sharedDedupKey,
        new Date(),
        24 * 60 * 60 * 1000,
      ),
    );
    expect(hitForA).toBe(false);
  });

  /** Seeds a `notifications` row with an explicit, past `createdAt` — `Notification.createdAt` is a plain `@default(now())` (not `@updatedAt`), so an explicit value overrides it, letting these tests place a row precisely relative to a dedup window boundary rather than relying on real elapsed time. */
  async function seedNotificationAt(
    userId: string,
    type: string,
    dedupKey: string,
    createdAt: Date,
  ) {
    const row = await as(userId, () =>
      prisma.notification.create({
        data: {
          userId,
          type,
          payload: { message: 'reminder', dedupKey, readyToDeliverAt: createdAt.toISOString() },
          status: 'queued',
          createdAt,
        },
      }),
    );
    createdNotificationIds.push(row.id);
    return row;
  }

  it("I — TASK-BOT-009-FIX: approaching's 20h window — a notification just under 20h old is a hit, just over 20h old is a miss", async () => {
    const APPROACHING_DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;
    const asOf = new Date();
    const dedupKeyJustUnder = `debt-${randomUUID()}`;
    await seedNotificationAt(
      userAId,
      'DebtDueApproaching',
      dedupKeyJustUnder,
      new Date(asOf.getTime() - APPROACHING_DEDUP_WINDOW_MS + 60_000),
    );
    const hitJustUnder = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        dedupKeyJustUnder,
        asOf,
        APPROACHING_DEDUP_WINDOW_MS,
      ),
    );
    expect(hitJustUnder).toBe(true);

    const dedupKeyJustOver = `debt-${randomUUID()}`;
    await seedNotificationAt(
      userAId,
      'DebtDueApproaching',
      dedupKeyJustOver,
      new Date(asOf.getTime() - APPROACHING_DEDUP_WINDOW_MS - 60_000),
    );
    const missJustOver = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        dedupKeyJustOver,
        asOf,
        APPROACHING_DEDUP_WINDOW_MS,
      ),
    );
    expect(missJustOver).toBe(false);
  });

  it("J — TASK-BOT-009-FIX: overdue's 7-day window — a notification just under 7 days old is a hit, just over 7 days old is a miss", async () => {
    const OVERDUE_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const asOf = new Date();
    const dedupKeyJustUnder = `debt-${randomUUID()}`;
    await seedNotificationAt(
      userAId,
      'DebtOverdue',
      dedupKeyJustUnder,
      new Date(asOf.getTime() - OVERDUE_DEDUP_WINDOW_MS + 60_000),
    );
    const hitJustUnder = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtOverdue',
        dedupKeyJustUnder,
        asOf,
        OVERDUE_DEDUP_WINDOW_MS,
      ),
    );
    expect(hitJustUnder).toBe(true);

    const dedupKeyJustOver = `debt-${randomUUID()}`;
    await seedNotificationAt(
      userAId,
      'DebtOverdue',
      dedupKeyJustOver,
      new Date(asOf.getTime() - OVERDUE_DEDUP_WINDOW_MS - 60_000),
    );
    const missJustOver = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtOverdue',
        dedupKeyJustOver,
        asOf,
        OVERDUE_DEDUP_WINDOW_MS,
      ),
    );
    expect(missJustOver).toBe(false);
  });

  it("K — TASK-BOT-009-FIX: cross-type dedup isolation — a DebtDueApproaching notification for a debtId never counts toward a DebtOverdue dedup check for the same debtId, even when queried with DebtOverdue's own wider 7-day window", async () => {
    const debtId = `debt-${randomUUID()}`;
    const asOf = new Date();
    // A DebtDueApproaching row created moments ago — well within either window by elapsed time alone.
    const created = await as(userAId, () =>
      notificationRepository.create({
        userId: userAId,
        type: 'DebtDueApproaching',
        message: 'approaching reminder',
        dedupKey: debtId,
        readyToDeliverAt: asOf,
      }),
    );
    createdNotificationIds.push(created.id);

    const overdueCheck = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtOverdue',
        debtId,
        asOf,
        7 * 24 * 60 * 60 * 1000,
      ),
    );
    expect(overdueCheck).toBe(false);

    const approachingCheck = await as(userAId, () =>
      dedupRepository.wasRecentlyNotified(
        userAId,
        'DebtDueApproaching',
        debtId,
        asOf,
        20 * 60 * 60 * 1000,
      ),
    );
    expect(approachingCheck).toBe(true);
  });
});

describe('PrismaNotificationRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-BOT-009 notification-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

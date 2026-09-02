import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaUserRepository } from './prisma-user.repository';

/**
 * Requires `docker compose up -d postgres` (packages/infrastructure/prisma's
 * migrations already applied — see repo root README / TASK-DB-002). Uses a
 * telegram_user_id far outside any real range so it can't collide with
 * seeded/dev data, and cleans up after itself.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_TELEGRAM_USER_ID = 900_000_000_001n;

describe('PrismaUserRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaUserRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
    await prisma.user.deleteMany({ where: { telegramUserId: TEST_TELEGRAM_USER_ID } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { telegramUserId: TEST_TELEGRAM_USER_ID } });
    await prisma.onModuleDestroy();
  });

  it('creates, finds, and reactivates a user through real Prisma/Postgres', async () => {
    const created = await repository.create({
      telegramUserId: TEST_TELEGRAM_USER_ID,
      telegramUsername: 'integration_test_user',
      displayName: 'Integration Test',
      preferredLanguage: 'uz',
    });
    expect(created.telegramUserId).toBe(TEST_TELEGRAM_USER_ID);
    expect(created.status).toBe('active');

    const found = await repository.findByTelegramUserId(TEST_TELEGRAM_USER_ID);
    expect(found?.id).toBe(created.id);

    await prisma.user.update({ where: { id: created.id }, data: { status: 'deactivated' } });
    const reactivated = await repository.reactivate(created.id);
    expect(reactivated.status).toBe('active');
  });

  it('updateProfile persists only the given fields, real read-after-write (FR-PROF-002/FR-PROF-004)', async () => {
    const telegramUserId = TEST_TELEGRAM_USER_ID + 7n;
    try {
      const created = await repository.create({ telegramUserId, preferredLanguage: 'en' });
      expect(created.defaultCurrency).toBe('UZS');

      const updated = await repository.updateProfile(created.id, {
        preferredLanguage: 'ru',
        timezone: 'Europe/Moscow',
      });
      expect(updated.preferredLanguage).toBe('ru');
      expect(updated.timezone).toBe('Europe/Moscow');
      // defaultCurrency was omitted from the update — must stay unchanged.
      expect(updated.defaultCurrency).toBe('UZS');

      const reFetched = await repository.findById(created.id);
      expect(reFetched?.preferredLanguage).toBe('ru');
      expect(reFetched?.timezone).toBe('Europe/Moscow');
    } finally {
      await prisma.user.deleteMany({ where: { telegramUserId } });
    }
  }, 30_000);

  it('resolves a concurrent double-create against the same telegram_user_id to a single row', async () => {
    const telegramUserId = TEST_TELEGRAM_USER_ID + 1n;
    try {
      const [first, second] = await Promise.all([
        repository.create({ telegramUserId }),
        repository.create({ telegramUserId }),
      ]);
      expect(first.id).toBe(second.id);

      const rows = await prisma.user.findMany({ where: { telegramUserId } });
      expect(rows).toHaveLength(1);
    } finally {
      await prisma.user.deleteMany({ where: { telegramUserId } });
    }
  });

  describe('TASK-AUTH-006 — requestDeletion / cancelDeletion / findExpiredPendingDeletions', () => {
    it('cancelDeletion succeeds within the grace period and clears deletionRequestedAt', async () => {
      const telegramUserId = TEST_TELEGRAM_USER_ID + 2n;
      try {
        const created = await repository.create({ telegramUserId });
        const requestedAt = new Date();
        await repository.requestDeletion(created.id, requestedAt);

        const cancelled = await repository.cancelDeletion(created.id, new Date());

        expect(cancelled?.status).toBe('active');
        expect(cancelled?.deletionRequestedAt).toBeNull();
      } finally {
        await prisma.user.deleteMany({ where: { telegramUserId } });
      }
    });

    it('cancelDeletion fails once the grace period has actually elapsed (real Postgres boundary, not just in-memory math)', async () => {
      const telegramUserId = TEST_TELEGRAM_USER_ID + 3n;
      try {
        const created = await repository.create({ telegramUserId });
        const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        await repository.requestDeletion(created.id, longAgo);

        const cancelled = await repository.cancelDeletion(created.id, new Date());

        expect(cancelled).toBeNull();
        const stillPending = await repository.findById(created.id);
        expect(stillPending?.status).toBe('pending_deletion');
      } finally {
        await prisma.user.deleteMany({ where: { telegramUserId } });
      }
    });

    it('findExpiredPendingDeletions returns only a genuinely expired pending_deletion user, never an active or not-yet-expired one', async () => {
      const expiredTelegramId = TEST_TELEGRAM_USER_ID + 4n;
      const notYetExpiredTelegramId = TEST_TELEGRAM_USER_ID + 5n;
      const activeTelegramId = TEST_TELEGRAM_USER_ID + 6n;
      try {
        const expiredUser = await repository.create({ telegramUserId: expiredTelegramId });
        await repository.requestDeletion(
          expiredUser.id,
          new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        );

        const notYetExpiredUser = await repository.create({
          telegramUserId: notYetExpiredTelegramId,
        });
        await repository.requestDeletion(notYetExpiredUser.id, new Date());

        await repository.create({ telegramUserId: activeTelegramId });

        const now = new Date();
        const expired = await repository.findExpiredPendingDeletions(now);
        const expiredIds = expired.map((u) => u.id);

        expect(expiredIds).toContain(expiredUser.id);
        expect(expiredIds).not.toContain(notYetExpiredUser.id);
      } finally {
        await prisma.user.deleteMany({
          where: {
            telegramUserId: { in: [expiredTelegramId, notYetExpiredTelegramId, activeTelegramId] },
          },
        });
      }
    });
  });

  describe('web admin panel — block / listUsers / countUsers', () => {
    it('block() atomically transitions an active user to deactivated, and returns null on a repeated attempt', async () => {
      const telegramUserId = TEST_TELEGRAM_USER_ID + 8n;
      try {
        const created = await repository.create({ telegramUserId });

        const blocked = await repository.block(created.id);
        expect(blocked?.status).toBe('deactivated');

        const again = await repository.block(created.id);
        expect(again).toBeNull();
      } finally {
        await prisma.user.deleteMany({ where: { telegramUserId } });
      }
    });

    it('listUsers/countUsers filter by status and paginate, real read-after-write', async () => {
      const activeTelegramId = TEST_TELEGRAM_USER_ID + 9n;
      const deactivatedTelegramId = TEST_TELEGRAM_USER_ID + 10n;
      try {
        const activeUser = await repository.create({ telegramUserId: activeTelegramId });
        const deactivatedUser = await repository.create({ telegramUserId: deactivatedTelegramId });
        await repository.block(deactivatedUser.id);

        const deactivatedOnly = await repository.listUsers({
          status: 'deactivated',
          limit: 50,
          offset: 0,
        });
        const deactivatedIds = deactivatedOnly.map((u) => u.id);
        expect(deactivatedIds).toContain(deactivatedUser.id);
        expect(deactivatedIds).not.toContain(activeUser.id);

        const deactivatedCount = await repository.countUsers({ status: 'deactivated' });
        expect(deactivatedCount).toBeGreaterThanOrEqual(1);
      } finally {
        await prisma.user.deleteMany({
          where: { telegramUserId: { in: [activeTelegramId, deactivatedTelegramId] } },
        });
      }
    });
  });
});

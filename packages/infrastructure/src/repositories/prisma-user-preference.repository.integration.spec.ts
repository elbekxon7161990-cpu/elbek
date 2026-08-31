import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { runWithUserContext } from '@afa/shared';

import { PRISMA_BASE_CLIENT, PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaNotificationPreferenceRepository } from './prisma-notification-preference.repository';
import { PrismaUserPreferenceRepository } from './prisma-user-preference.repository';

/**
 * `/settings` real-Postgres proof for `PrismaUserPreferenceRepository`, and
 * critically, that a value it writes is correctly read back by the
 * EXISTING, unmodified `PrismaNotificationPreferenceRepository.isEnabled` —
 * the compatibility guarantee this repository's own doc comment promises.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TELEGRAM_USER_ID = 900_000_001_100n;

describe('PrismaUserPreferenceRepository — TASK-BOT-SET (real Postgres)', () => {
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let repository: PrismaUserPreferenceRepository;
  let notificationPreferenceRepository: PrismaNotificationPreferenceRepository;
  let userId: string;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();
    basePrisma = moduleRef.get(PRISMA_BASE_CLIENT);
    prisma = moduleRef.get(PrismaService);
    await basePrisma.onModuleInit();
    repository = new PrismaUserPreferenceRepository(prisma);
    notificationPreferenceRepository = new PrismaNotificationPreferenceRepository(prisma);

    const user = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Preference Test User',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    await basePrisma
      .$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, false)`, userId)
      .catch(() => undefined);
    await basePrisma
      .$executeRawUnsafe(`DELETE FROM user_settings WHERE user_id = $1::uuid`, userId)
      .catch(() => undefined);
    await basePrisma
      .$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId)
      .catch(() => undefined);
    await basePrisma.onModuleDestroy();
  }, 30_000);

  it('A — getBoolean returns the given default when no row has ever been written', async () => {
    const value = await asUser(() => repository.getBoolean(userId, 'confidence_display', true));
    expect(value).toBe(true);
  });

  it('B — setBoolean then getBoolean round-trips the real value (read-after-write)', async () => {
    await asUser(() => repository.setBoolean(userId, 'confidence_display', false));
    const value = await asUser(() => repository.getBoolean(userId, 'confidence_display', true));
    expect(value).toBe(false);
  });

  it('C — setBoolean is idempotent on repeated writes (upsert, never a duplicate-key error)', async () => {
    await asUser(() => repository.setBoolean(userId, 'confidence_display', true));
    await asUser(() => repository.setBoolean(userId, 'confidence_display', true));
    const value = await asUser(() => repository.getBoolean(userId, 'confidence_display', false));
    expect(value).toBe(true);
  });

  it('D — a value written here is correctly read by the existing, unmodified NotificationPreferenceRepository.isEnabled', async () => {
    await asUser(() => repository.setBoolean(userId, 'notif_debt_reminder', false));
    const enabled = await asUser(() =>
      notificationPreferenceRepository.isEnabled(userId, 'notif_debt_reminder'),
    );
    expect(enabled).toBe(false);

    await asUser(() => repository.setBoolean(userId, 'notif_debt_reminder', true));
    const enabledAfter = await asUser(() =>
      notificationPreferenceRepository.isEnabled(userId, 'notif_debt_reminder'),
    );
    expect(enabledAfter).toBe(true);
  });
});

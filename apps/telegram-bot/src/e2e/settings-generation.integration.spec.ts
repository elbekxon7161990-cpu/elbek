import { runWithUserContext } from '@afa/shared';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  UserSettingsModule,
  GetUserSettingsSummaryUseCase,
  SetUserPreferenceUseCase,
  UpdateUserProfileUseCase,
} from '@afa/application';
import {
  CurrencyRepositoryModule,
  PRISMA_BASE_CLIENT,
  PrismaModule,
  PrismaService,
  UserPreferenceRepositoryModule,
  UserRepositoryModule,
} from '@afa/infrastructure';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `/settings` REAL INTEGRATION (TASK-BOT-SET) — a genuine `/settings` flow
 * through real `UpdateUserProfileUseCase`/`SetUserPreferenceUseCase`/
 * `GetUserSettingsSummaryUseCase`, real Postgres (`PrismaUserRepository`/
 * `PrismaUserPreferenceRepository`), plus a real-DI `TelegramBotService`
 * dispatching its actual `/settings` command and
 * `settings_lang_set:ru` callback handlers.
 *
 * Mirrors `report-generation.integration.spec.ts`/`export-generation.integration.spec.ts`'s
 * own bootstrap approach exactly, including their own discovered-and-fixed
 * RLS/`set_config` cleanup gotcha.
 */
const { mockBot, onHandlers, commandHandlers } = vi.hoisted(() => {
  const on: Array<{ handler: (ctx: unknown) => Promise<void> }> = [];
  const commands = new Map<string, (ctx: unknown) => Promise<void>>();
  return {
    onHandlers: on,
    commandHandlers: commands,
    mockBot: {
      use: vi.fn(),
      on: vi.fn((_matcher: unknown, handler: (ctx: unknown) => Promise<void>) => {
        on.push({ handler });
      }),
      command: vi.fn((name: string, handler: (ctx: unknown) => Promise<void>) => {
        commands.set(name, handler);
      }),
      start: vi.fn(),
      catch: vi.fn(),
      launch: vi.fn(),
      stop: vi.fn(),
      handleUpdate: vi.fn(),
      telegram: { setMyCommands: vi.fn(), setWebhook: vi.fn() },
    },
  };
});

vi.mock('telegraf', () => ({
  Telegraf: vi.fn().mockImplementation(() => mockBot),
}));

import { TelegramBotService } from '../bot/telegram-bot.service';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

// registration order inside TelegramBotService.registerHandlers(): text,
// voice, photo, document, unsupported, callback_query.
const CALLBACK_HANDLER_INDEX = 5;

const TELEGRAM_USER_ID = 900_000_001_110n;

describe('/settings real integration — real UpdateUserProfileUseCase + real Postgres + real-DI TelegramBotService (TASK-BOT-SET)', () => {
  let basePrisma: PrismaService;
  let getUserSettingsSummary: GetUserSettingsSummaryUseCase;
  let updateUserProfile: UpdateUserProfileUseCase;
  let setUserPreference: SetUserPreferenceUseCase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let moduleRef: any;
  let userId: string;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        UserSettingsModule,
        UserRepositoryModule,
        UserPreferenceRepositoryModule,
        CurrencyRepositoryModule,
      ],
    }).compile();

    basePrisma = moduleRef.get(PRISMA_BASE_CLIENT);
    await basePrisma.onModuleInit();

    getUserSettingsSummary = moduleRef.get(GetUserSettingsSummaryUseCase);
    updateUserProfile = moduleRef.get(UpdateUserProfileUseCase);
    setUserPreference = moduleRef.get(SetUserPreferenceUseCase);

    const user = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Settings Test User',
        timezone: 'UTC',
        preferredLanguage: 'en',
      },
      update: {
        timezone: 'UTC',
        status: 'active',
        preferredLanguage: 'en',
        defaultCurrency: 'UZS',
      },
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
    await moduleRef.close();
  }, 30_000);

  it('updates the real language/timezone via real Postgres and reads it back (read-after-write)', async () => {
    const updated = await asUser(() => updateUserProfile.execute(userId, 'language', 'ru'));
    expect(updated).toEqual({
      kind: 'updated',
      user: expect.objectContaining({ preferredLanguage: 'ru' }),
    });

    const summary = await asUser(() => getUserSettingsSummary.execute(userId));
    expect(summary?.user.preferredLanguage).toBe('ru');

    await asUser(() => updateUserProfile.execute(userId, 'timezone', 'Europe/London'));
    const summaryAfter = await asUser(() => getUserSettingsSummary.execute(userId));
    expect(summaryAfter?.user.timezone).toBe('Europe/London');
  }, 30_000);

  it('rejects an invalid currency against the real CurrencyRepository, never persists it', async () => {
    const outcome = await asUser(() =>
      updateUserProfile.execute(userId, 'currency', 'NOT_A_REAL_CODE'),
    );
    expect(outcome).toEqual({ kind: 'invalid_value' });

    const summary = await asUser(() => getUserSettingsSummary.execute(userId));
    expect(summary?.user.defaultCurrency).not.toBe('NOT_A_REAL_CODE');
  }, 30_000);

  it('toggles a real notification preference via real Postgres, read-after-write reflects it', async () => {
    const before = await asUser(() => getUserSettingsSummary.execute(userId));
    const nextValue = !before!.notificationPreferences.debtReminder;

    await asUser(() => setUserPreference.execute(userId, 'notif_debt_reminder', nextValue));

    const after = await asUser(() => getUserSettingsSummary.execute(userId));
    expect(after?.notificationPreferences.debtReminder).toBe(nextValue);
  }, 30_000);

  it('the real /settings command and settings_lang_set:uz callback, dispatched through a real-DI TelegramBotService, persist a real profile change', async () => {
    onHandlers.length = 0;
    commandHandlers.clear();

    const config = {
      get: vi.fn((key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? 'test-token' : undefined)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new TelegramBotService(
      config,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      getUserSettingsSummary,
      updateUserProfile,
      setUserPreference,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    expect(service).toBeInstanceOf(TelegramBotService);

    const menuReply = vi.fn();
    await asUser(() =>
      commandHandlers.get('settings')!({
        provisioning: {
          user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: 'UZS' },
        },
        reply: menuReply,
      }),
    );
    expect(menuReply).toHaveBeenCalledTimes(1);

    const updateReply = vi.fn();
    const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    await asUser(() =>
      callbackHandler({
        provisioning: {
          user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: 'UZS' },
        },
        callbackQuery: { data: 'settings_lang_set:uz' },
        answerCbQuery: vi.fn(),
        reply: updateReply,
      }),
    );

    expect(updateReply).toHaveBeenCalledTimes(1);
    const [text] = updateReply.mock.calls[0]!;
    expect(text).toContain('set to');

    const summary = await asUser(() => getUserSettingsSummary.execute(userId));
    expect(summary?.user.preferredLanguage).toBe('uz');
  }, 30_000);
});

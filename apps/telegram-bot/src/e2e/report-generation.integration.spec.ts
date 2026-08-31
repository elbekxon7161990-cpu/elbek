import { runWithUserContext } from '@afa/shared';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GenerateReportModule, GenerateReportUseCase } from '@afa/application';
import {
  REPORT_CACHE_REPOSITORY,
  computeDailyBoundary,
  type ReportCacheRepository,
} from '@afa/domain';
import {
  PRISMA_BASE_CLIENT,
  PrismaModule,
  PrismaReportQueryRepository,
  PrismaService,
  PrismaTransactionRepository,
  ReportCacheRepositoryModule,
  ReportQueryRepositoryModule,
} from '@afa/infrastructure';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `/report` REAL INTEGRATION (TASK-REP-TG) — a genuine `/report` flow
 * through real `GenerateReportUseCase`, real Postgres (`PrismaReportQueryRepository`),
 * and real Redis (`RedisReportCacheRepository`), plus a real DI-constructed
 * `TelegramBotService` dispatching its actual `/report` command and
 * `report_type:daily` callback handlers.
 *
 * Mirrors `../e2e/search-transactions-query.integration.spec.ts`'s own
 * bootstrap approach exactly (`Test.createTestingModule` +
 * `ConfigModule.forRoot()` + `PrismaModule`, `PRISMA_BASE_CLIENT` for
 * owner-role fixture setup/teardown, `PrismaService` for the RLS-scoped
 * client production code actually gets) — that task's own doc comment
 * explains why a hand-rolled `new PrismaService(...)` fails Postgres auth in
 * this environment; only the `ConfigModule.forRoot()`-driven path picks up
 * this environment's real `DATABASE_URL`.
 *
 * `telegraf`'s `Telegraf` class is mocked — the ONE boundary this test does
 * not exercise for real, since sending an actual Telegram message needs a
 * live bot token + chat that don't exist in this environment (the same
 * boundary `telegram-bot.service.spec.ts`'s own unit tests already accept).
 * `GenerateReportUseCase`, `PrismaReportQueryRepository`, and the real Redis
 * cache repository are never mocked or faked here.
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

// registration order inside TelegramBotService.registerHandlers(): text,
// voice, photo, document, unsupported, callback_query (see
// telegram-bot.service.spec.ts's own CALLBACK_HANDLER_INDEX for precedent).
const CALLBACK_HANDLER_INDEX = 5;

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const TELEGRAM_USER_ID = 900_000_001_070n;
const DEFAULT_CURRENCY = 'UZS';

describe('/report real integration — real GenerateReportUseCase + real Postgres + real Redis (TASK-REP-TG)', () => {
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let transactionRepository: PrismaTransactionRepository;
  let reportQueryRepository: PrismaReportQueryRepository;
  let generateReport: GenerateReportUseCase;
  let reportCacheRepository: ReportCacheRepository;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let moduleRef: any;

  let userId: string;
  let categoryId: string;
  const createdTransactionIds: string[] = [];
  // "Now", not a fixed date — the real /report command handler always calls
  // `generateDaily(userId, new Date())` with no way to inject a fixed
  // `asOf` from a test, so the fixture transaction must fall on today's
  // calendar day for both the direct use-case test and the real
  // TelegramBotService dispatch test to agree on the same daily total.
  const asOf = new Date();
  const dailyPeriodKey = computeDailyBoundary(asOf).periodKey;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        GenerateReportModule,
        ReportQueryRepositoryModule,
        ReportCacheRepositoryModule,
      ],
    }).compile();

    basePrisma = moduleRef.get(PRISMA_BASE_CLIENT);
    prisma = moduleRef.get(PrismaService);
    await basePrisma.onModuleInit();

    transactionRepository = new PrismaTransactionRepository(prisma, basePrisma);
    reportQueryRepository = new PrismaReportQueryRepository(prisma, basePrisma);
    generateReport = moduleRef.get(GenerateReportUseCase);
    reportCacheRepository = moduleRef.get(REPORT_CACHE_REPOSITORY);

    const user = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Report Test User',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userId = user.id;

    const category = await basePrisma.category.findFirst({
      where: { status: 'active', parentCategoryId: null },
    });
    if (!category) {
      throw new Error('Need at least 1 active top-level category — run `prisma db seed` first.');
    }
    categoryId = category.id;

    const txn = await asUser(() =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        amount: '25000.00',
        currency: DEFAULT_CURRENCY,
        categoryId,
        merchant: 'Report Fixture Store',
        transactionDate: asOf,
        description: 'report integration fixture',
        originalText: 'report integration fixture',
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(txn.id);
  }, 30_000);

  afterAll(async () => {
    // Guarded: if beforeAll failed partway through (e.g. a transient
    // connectivity error), some of these may never have been assigned —
    // clean up only what actually got created.
    if (reportCacheRepository && userId) {
      await reportCacheRepository
        .set(userId, 'daily', dailyPeriodKey, '', 1)
        .catch(() => undefined);
    }
    if (basePrisma) {
      // `basePrisma` bypasses the RLS Prisma-extension's own
      // require-a-context guard, but the underlying Postgres RLS POLICY on
      // `transactions` still evaluates `current_setting('app.current_user_id')`
      // regardless of which Prisma client issued the query — and a
      // just-created raw-client session never has that GUC set, so a raw
      // delete fails with "invalid input syntax for type uuid" (an empty
      // default) rather than a permission error. Setting it explicitly first
      // (same GUC `rls-context.extension.ts` itself sets, non-local since
      // this cleanup isn't wrapped in one `$transaction`) fixes that —
      // discovered while diagnosing this exact symptom for this task.
      if (userId) {
        await basePrisma
          .$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, false)`, userId)
          .catch(() => undefined);
      }
      if (createdTransactionIds.length > 0) {
        await basePrisma
          .$executeRawUnsafe(
            `DELETE FROM transactions WHERE id = ANY($1::uuid[])`,
            createdTransactionIds,
          )
          .catch(() => undefined);
      }
      if (userId) {
        await basePrisma
          .$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId)
          .catch(() => undefined);
      }
      await basePrisma.onModuleDestroy();
    }
    if (moduleRef) {
      // Deliberately NOT calling `REDIS_CLIENT.quit()` here — `moduleRef.close()`
      // already runs `OnModuleDestroy` for whatever provides it, and quitting
      // it a second time here raced with that teardown, surfacing as an
      // uncaught "Connection is closed" throw from inside ioredis's own
      // socket-close handler (not a promise rejection `.catch()` can stop) —
      // observed failing this suite despite every assertion above already
      // passing against real Postgres/Redis.
      await moduleRef.close();
    }
  }, 30_000);

  it('generateDaily computes real totals from real Postgres and populates the real Redis cache', async () => {
    const report = await asUser(() => generateReport.generateDaily(userId, asOf));

    expect(report.totalExpense).toBe('25000.00');
    expect(report.categoryBreakdown).toEqual(
      expect.arrayContaining([expect.objectContaining({ categoryId, totalAmount: '25000.00' })]),
    );

    const cached = await reportCacheRepository.get(userId, 'daily', dailyPeriodKey);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toEqual(
      expect.objectContaining({ totalExpense: '25000.00', totalIncome: '0.00' }),
    );
  });

  it('user ownership isolation: a different (never-provisioned) user id sees no data from this fixture', async () => {
    const otherUserId = '00000000-0000-0000-0000-000000000000';
    const result = await runWithUserContext(otherUserId, () =>
      reportQueryRepository.getCategoryBreakdown(
        otherUserId,
        { start: new Date('2026-08-01'), end: new Date('2026-08-31') },
        { transactionType: 'EXPENSE' },
      ),
    );
    expect(result).toEqual([]);
  });

  it('the real /report command and report_type:daily callback, dispatched through a real-DI TelegramBotService, render the real computed totals', async () => {
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
      generateReport,
      reportQueryRepository,
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
    );
    expect(service).toBeInstanceOf(TelegramBotService);

    const menuReply = vi.fn();
    await commandHandlers.get('report')!({
      provisioning: {
        user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: DEFAULT_CURRENCY },
      },
      reply: menuReply,
    });
    expect(menuReply).toHaveBeenCalledTimes(1);

    const reportReply = vi.fn();
    const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    await asUser(() =>
      callbackHandler({
        provisioning: {
          user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: DEFAULT_CURRENCY },
        },
        callbackQuery: { data: 'report_type:daily' },
        answerCbQuery: vi.fn(),
        reply: reportReply,
      }),
    );

    expect(reportReply).toHaveBeenCalledTimes(1);
    const [text] = reportReply.mock.calls[0]!;
    expect(text).toContain('25000.00');
  });
});

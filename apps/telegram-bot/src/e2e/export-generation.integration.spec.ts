import { Buffer } from 'node:buffer';

import { runWithUserContext } from '@afa/shared';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ExportTransactionsModule, ExportTransactionsUseCase } from '@afa/application';
import {
  ExportQueryRepositoryModule,
  PRISMA_BASE_CLIENT,
  PrismaModule,
  PrismaService,
  PrismaTransactionRepository,
  XlsxGeneratorModule,
} from '@afa/infrastructure';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

/**
 * `/export` REAL INTEGRATION (TASK-FIN-014) — a genuine `/export` flow
 * through real `ExportTransactionsUseCase`, real Postgres
 * (`PrismaExportQueryRepository`), and a real `exceljs` workbook, plus a
 * real-DI `TelegramBotService` dispatching its actual `/export` command and
 * `export_range:this_month` callback handlers.
 *
 * Mirrors `report-generation.integration.spec.ts`'s own bootstrap approach
 * exactly, including that task's own discovered-and-fixed RLS/`set_config`
 * cleanup gotcha (see this file's own `afterAll`).
 *
 * `telegraf`'s `Telegraf` class is mocked — the ONE boundary this test does
 * not exercise for real, since sending an actual Telegram document needs a
 * live bot token + chat that don't exist in this environment (the same
 * boundary `report-generation.integration.spec.ts`/`telegram-bot.service.spec.ts`'s
 * own unit tests already accept). `ExportTransactionsUseCase`,
 * `PrismaExportQueryRepository`, and the real `exceljs` workbook generator
 * are never mocked or faked here.
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

const TELEGRAM_USER_ID = 900_000_001_090n;
const DEFAULT_CURRENCY = 'UZS';

describe('/export real integration — real ExportTransactionsUseCase + real Postgres + real exceljs (TASK-FIN-014)', () => {
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let transactionRepository: PrismaTransactionRepository;
  let exportTransactions: ExportTransactionsUseCase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let moduleRef: any;

  let userId: string;
  let categoryId: string;
  const createdTransactionIds: string[] = [];
  const asOf = new Date();

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ExportTransactionsModule,
        ExportQueryRepositoryModule,
        XlsxGeneratorModule,
      ],
    }).compile();

    basePrisma = moduleRef.get(PRISMA_BASE_CLIENT);
    prisma = moduleRef.get(PrismaService);
    await basePrisma.onModuleInit();

    transactionRepository = new PrismaTransactionRepository(prisma, basePrisma);
    exportTransactions = moduleRef.get(ExportTransactionsUseCase);

    const user = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Export Test User',
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
        amount: '30000.00',
        currency: DEFAULT_CURRENCY,
        categoryId,
        merchant: 'Export Fixture Store',
        paymentMethod: 'cash',
        tags: ['export-fixture'],
        transactionDate: asOf,
        description: 'export integration fixture',
        originalText: 'export integration fixture',
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(txn.id);
  }, 30_000);

  afterAll(async () => {
    // Same RLS/`set_config` requirement `report-generation.integration.spec.ts`'s
    // own afterAll already documents — a single user here, so one context
    // covers all of it (no multi-user GUC-scoping pitfall to worry about).
    await basePrisma
      .$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, false)`, userId)
      .catch(() => undefined);
    if (createdTransactionIds.length > 0) {
      await basePrisma
        .$executeRawUnsafe(
          `DELETE FROM transactions WHERE id = ANY($1::uuid[])`,
          createdTransactionIds,
        )
        .catch(() => undefined);
    }
    await basePrisma
      .$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId)
      .catch(() => undefined);
    await basePrisma.onModuleDestroy();
    await moduleRef.close();
  }, 30_000);

  it('generates a real xlsx workbook from real Postgres data with the correct total row', async () => {
    const outcome = await asUser(() =>
      exportTransactions.execute(userId, { start: new Date(0), end: new Date('2999-01-01') }),
    );

    expect(outcome.kind).toBe('generated');
    if (outcome.kind !== 'generated') {
      throw new Error('expected a generated export');
    }
    expect(outcome.rowCount).toBeGreaterThanOrEqual(1);

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(outcome.buffer as any);
    const sheet = workbook.getWorksheet('Transactions');
    expect(sheet).toBeDefined();
    const headerRow = sheet!.getRow(1).values as unknown[];
    expect(headerRow).toContain('Amount');
    expect(headerRow).toContain('Category');

    const dataRow = sheet!.getRow(2).values as unknown[];
    expect(dataRow).toContain('Export Fixture Store');
  });

  it('the real /export command and export_range:this_month callback, dispatched through a real-DI TelegramBotService, send a real xlsx document', async () => {
    onHandlers.length = 0;
    commandHandlers.clear();

    const config = {
      get: vi.fn((key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? 'test-token' : undefined)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const reportQueryRepositoryStub = {
      getTotals: vi.fn(),
      getCategoryBreakdown: vi.fn(),
      getMerchantBreakdown: vi.fn(),
      getPeriodicBreakdown: vi.fn(),
      getLargestTransactions: vi.fn(),
      getTransactionCount: vi.fn(),
      getEarliestTransactionDate: vi.fn(),
      getCashFlow: vi.fn(),
      searchTransactions: vi.fn(),
    };

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      reportQueryRepositoryStub as any,
      exportTransactions,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    await commandHandlers.get('export')!({
      provisioning: {
        user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: DEFAULT_CURRENCY },
      },
      reply: menuReply,
    });
    expect(menuReply).toHaveBeenCalledTimes(1);

    const replyWithDocument = vi.fn();
    const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    await asUser(() =>
      callbackHandler({
        provisioning: {
          user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: DEFAULT_CURRENCY },
        },
        callbackQuery: { data: 'export_range:all_time' },
        answerCbQuery: vi.fn(),
        reply: vi.fn(),
        replyWithDocument,
      }),
    );

    expect(replyWithDocument).toHaveBeenCalledTimes(1);
    const [document] = replyWithDocument.mock.calls[0]!;
    expect(document.filename).toMatch(/^transactions_export_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(Buffer.isBuffer(document.source)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(document.source);
    expect(workbook.getWorksheet('Transactions')).toBeDefined();
  });
});

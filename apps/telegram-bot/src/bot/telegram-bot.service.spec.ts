import { Buffer } from 'node:buffer';

import { getCurrentUserId, runWithUserContext } from '@afa/shared';
import type { EnvironmentVariables } from '@afa/shared';
import type { LoanWizardStateRecord } from '@afa/domain';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REPORT_TYPES } from './report-keyboard';
import { EXPORT_RANGE_PRESETS } from './export-keyboard';

const { mockBot, useHandlers, onHandlers, commandHandlers, catchHandlers } = vi.hoisted(() => {
  const handlers: Array<(ctx: unknown, next: () => Promise<void>) => Promise<void>> = [];
  const on: Array<{ handler: (ctx: unknown) => Promise<void> }> = [];
  const commands = new Map<string, (ctx: unknown) => Promise<void>>();
  const errorHandlers: Array<(error: unknown, ctx: unknown) => void> = [];
  return {
    useHandlers: handlers,
    onHandlers: on,
    commandHandlers: commands,
    catchHandlers: errorHandlers,
    mockBot: {
      use: vi.fn((handler: (ctx: unknown, next: () => Promise<void>) => Promise<void>) => {
        handlers.push(handler);
      }),
      on: vi.fn((_matcher: unknown, handler: (ctx: unknown) => Promise<void>) => {
        on.push({ handler });
      }),
      command: vi.fn((name: string, handler: (ctx: unknown) => Promise<void>) => {
        commands.set(name, handler);
      }),
      start: vi.fn(),
      catch: vi.fn((handler: (error: unknown, ctx: unknown) => void) => {
        errorHandlers.push(handler);
      }),
      launch: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      handleUpdate: vi.fn(),
      telegram: {
        setMyCommands: vi.fn(),
        setWebhook: vi.fn(),
      },
    },
  };
});

vi.mock('telegraf', () => ({
  Telegraf: vi.fn().mockImplementation(() => mockBot),
}));

import { TelegramBotService } from './telegram-bot.service';

function makeConfig(
  overrides: Record<string, unknown> = {},
): ConfigService<EnvironmentVariables, true> {
  const defaults: Record<string, unknown> = { TELEGRAM_BOT_TOKEN: 'test-token' };
  const values = { ...defaults, ...overrides };
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
}

function buildService(config: ConfigService<EnvironmentVariables, true> = makeConfig()) {
  const provisionTelegramUser = {
    execute: vi.fn().mockResolvedValue({
      user: { id: 'user-abc-123', timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' },
      isNewUser: false,
    }),
  };
  const routeTextMessage = { execute: vi.fn() };
  const routeCallbackQuery = { execute: vi.fn() };
  const routeVoiceMessage = { execute: vi.fn() };
  const routePhotoMessage = { execute: vi.fn() };
  const routeDocumentMessage = { execute: vi.fn() };
  const processConversationEvent = { execute: vi.fn() };
  const listDrafts = { execute: vi.fn().mockResolvedValue([]) };
  const listOpenDebts = { execute: vi.fn().mockResolvedValue([]) };
  const generateDashboard = { execute: vi.fn().mockResolvedValue({ kind: 'empty' }) };
  const listBudgets = { execute: vi.fn().mockResolvedValue([]) };
  const createBudget = { execute: vi.fn() };
  const categoryRepository = { findById: vi.fn(), findByCode: vi.fn() };
  const createLoan = { execute: vi.fn() };
  const logLoanPayment = { execute: vi.fn() };
  const listOpenLoans = { execute: vi.fn().mockResolvedValue([]) };
  const loanWizardStateRepository = {
    get: vi.fn(),
    compareAndSet: vi.fn().mockResolvedValue(true),
  };
  const currencyRepository = {
    isSupported: vi.fn().mockResolvedValue(true),
    listActiveCodes: vi.fn().mockResolvedValue(['UZS', 'USD', 'RUB']),
  };
  const searchTransactions = {
    execute: vi.fn().mockResolvedValue({
      results: [],
      totalCount: 0,
      page: 0,
      pageSize: 5,
      hasNextPage: false,
      hasPreviousPage: false,
    }),
  };
  const deleteTransactionUseCase = { execute: vi.fn() };
  const searchSessionRepository = {
    get: vi.fn(),
    compareAndSet: vi.fn().mockResolvedValue(true),
  };
  const requestAccountDeletion = { execute: vi.fn() };
  const cancelAccountDeletion = { execute: vi.fn() };
  const accountDeletionConfirmationRepository = {
    markAwaitingConfirmation: vi.fn(),
    isAwaitingConfirmation: vi.fn().mockResolvedValue(false),
    clear: vi.fn(),
  };
  const generateReport = {
    generateDaily: vi.fn(),
    generateWeekly: vi.fn(),
    generateMonthly: vi.fn(),
    generateQuarterly: vi.fn(),
    generateYearly: vi.fn(),
    generateCashFlow: vi.fn(),
    generateDebtSummary: vi.fn(),
    generateCategoryReport: vi.fn(),
    generateMerchantReport: vi.fn(),
    generateCustomRange: vi.fn(),
    generateTrendAnalysis: vi.fn(),
  };
  const reportQueryRepository = {
    getTotals: vi.fn(),
    getCategoryBreakdown: vi.fn().mockResolvedValue([]),
    getMerchantBreakdown: vi.fn().mockResolvedValue([]),
    getPeriodicBreakdown: vi.fn(),
    getLargestTransactions: vi.fn(),
    getTransactionCount: vi.fn(),
    getEarliestTransactionDate: vi.fn(),
    getCashFlow: vi.fn(),
    searchTransactions: vi.fn(),
  };
  const exportTransactions = { execute: vi.fn() };
  const getUserSettingsSummary = { execute: vi.fn() };
  const updateUserProfile = { execute: vi.fn() };
  const setUserPreference = { execute: vi.fn() };
  const undoLastTransactionAction = { execute: vi.fn() };
  const createCustomCategory = {
    execute: vi.fn(),
    checkNameAvailability: vi.fn(),
    listParentOptions: vi.fn(),
  };
  const listCustomCategories = { execute: vi.fn() };
  const deleteCustomCategory = { preview: vi.fn(), execute: vi.fn() };
  const customCategoryWizardStateRepository = { get: vi.fn(), compareAndSet: vi.fn() };

  const service = new TelegramBotService(
    config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provisionTelegramUser as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routeTextMessage as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routeCallbackQuery as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routeVoiceMessage as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routePhotoMessage as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routeDocumentMessage as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processConversationEvent as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listDrafts as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listOpenDebts as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateDashboard as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listBudgets as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createBudget as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categoryRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createLoan as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logLoanPayment as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listOpenLoans as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loanWizardStateRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currencyRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    searchTransactions as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteTransactionUseCase as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    searchSessionRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestAccountDeletion as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cancelAccountDeletion as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accountDeletionConfirmationRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateReport as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reportQueryRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exportTransactions as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getUserSettingsSummary as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateUserProfile as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setUserPreference as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    undoLastTransactionAction as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createCustomCategory as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listCustomCategories as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteCustomCategory as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customCategoryWizardStateRepository as any,
  );

  return {
    service,
    provisionTelegramUser,
    routeTextMessage,
    routeCallbackQuery,
    routeVoiceMessage,
    routePhotoMessage,
    routeDocumentMessage,
    processConversationEvent,
    listDrafts,
    listOpenDebts,
    generateDashboard,
    listBudgets,
    createBudget,
    categoryRepository,
    createLoan,
    logLoanPayment,
    listOpenLoans,
    loanWizardStateRepository,
    currencyRepository,
    searchTransactions,
    deleteTransactionUseCase,
    searchSessionRepository,
    requestAccountDeletion,
    cancelAccountDeletion,
    accountDeletionConfirmationRepository,
    generateReport,
    reportQueryRepository,
    exportTransactions,
    getUserSettingsSummary,
    updateUserProfile,
    setUserPreference,
    undoLastTransactionAction,
    createCustomCategory,
    listCustomCategories,
    deleteCustomCategory,
    customCategoryWizardStateRepository,
  };
}

/** TASK-BOT-008 — every real handler now reads `ctx.provisioning.user.preferredLanguage`; the auth middleware always sets `ctx.provisioning` before any handler runs in production, so every fixture below must too, even handlers that previously never touched it. */
function provisioning(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      preferredLanguage: 'en',
      timezone: 'Asia/Tashkent',
      defaultCurrency: 'UZS',
      ...overrides,
    },
  };
}

const AUTH_MIDDLEWARE_INDEX = 0;
// registration order inside registerHandlers(): text, voice, photo, document, unsupported, callback_query
const TEXT_HANDLER_INDEX = 0;
const VOICE_HANDLER_INDEX = 1;
const PHOTO_HANDLER_INDEX = 2;
const DOCUMENT_HANDLER_INDEX = 3;
const UNSUPPORTED_HANDLER_INDEX = 4;
const CALLBACK_HANDLER_INDEX = 5;

describe('TelegramBotService — RLS user-context propagation (TASK-DB-011)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  it('runs downstream processing with the resolved user id available via ALS (test #12)', async () => {
    const resolvedUser = { id: 'user-abc-123' };
    const provisionTelegramUser = {
      execute: vi.fn().mockResolvedValue({ user: resolvedUser, isNewUser: false }),
    };

    new TelegramBotService(
      makeConfig(),
      provisionTelegramUser as any,
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
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;

    let userIdSeenDownstream: string | undefined;
    const ctx = { from: { id: 42, username: 'ada' } };
    const next = async () => {
      userIdSeenDownstream = getCurrentUserId();
    };

    await authMiddleware(ctx, next);

    expect(provisionTelegramUser.execute).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: 42n }),
    );
    expect(userIdSeenDownstream).toBe('user-abc-123');
    // No leakage past the middleware call.
    expect(getCurrentUserId()).toBeUndefined();
  });

  it('does not establish a context when the update carries no ctx.from', async () => {
    const provisionTelegramUser = { execute: vi.fn() };

    new TelegramBotService(
      makeConfig(),
      provisionTelegramUser as any,
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
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
    let nextCalled = false;
    const next = async () => {
      nextCalled = true;
      expect(getCurrentUserId()).toBeUndefined();
    };

    await authMiddleware({ from: undefined }, next);

    expect(provisionTelegramUser.execute).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('rejects a group-chat update with a private-chat-only message, before provisioning (§7.2.9/AC-CMA-005)', async () => {
    const provisionTelegramUser = { execute: vi.fn() };

    new TelegramBotService(
      makeConfig(),
      provisionTelegramUser as any,
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
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
    const reply = vi.fn();
    let nextCalled = false;
    const ctx = { chat: { type: 'group' }, from: { id: 42 }, reply };
    const next = async () => {
      nextCalled = true;
    };

    await authMiddleware(ctx, next);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(provisionTelegramUser.execute).not.toHaveBeenCalled();
    expect(nextCalled).toBe(false);
  });
});

describe('TelegramBotService — update routing (TASK-BOT-001)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  it('registers setMyCommands with the full command inventory on module init (FR-BOT-001)', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    expect(mockBot.telegram.setMyCommands).toHaveBeenCalledTimes(1);
    const registered = mockBot.telegram.setMyCommands.mock.calls[0]![0] as { command: string }[];
    expect(registered.map((c) => c.command)).toContain('start');
    expect(registered.map((c) => c.command)).toContain('cancel');
    expect(registered.map((c) => c.command)).toContain('loans');
    expect(registered).toHaveLength(14);
  });

  it('launches long-polling when no webhook secret/URL are configured (Chapter 17 §17.2)', async () => {
    const { service } = buildService(makeConfig());
    await service.onModuleInit();

    expect(mockBot.launch).toHaveBeenCalledTimes(1);
    expect(mockBot.telegram.setWebhook).not.toHaveBeenCalled();
  });

  it('registers a webhook and never launches long-polling when a secret and URL are configured', async () => {
    const { service } = buildService(
      makeConfig({
        TELEGRAM_WEBHOOK_SECRET: 'shh',
        TELEGRAM_WEBHOOK_URL: 'https://example.com/telegram/webhook',
      }),
    );
    await service.onModuleInit();

    expect(mockBot.telegram.setWebhook).toHaveBeenCalledWith(
      'https://example.com/telegram/webhook',
      { secret_token: 'shh' },
    );
    expect(mockBot.launch).not.toHaveBeenCalled();
  });

  it('delegates handleUpdate to the underlying Telegraf instance (webhook controller integration)', async () => {
    const { service } = buildService();
    const update = { update_id: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.handleUpdate(update as any);

    expect(mockBot.handleUpdate).toHaveBeenCalledWith(update);
  });

  it('routes a text message through RouteTextMessageUseCase and replies based on the outcome', async () => {
    const { routeTextMessage } = buildService();
    routeTextMessage.execute.mockResolvedValue({ kind: 'no_transaction_detected' });

    const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = {
      provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
      message: { text: 'hello' },
      reply,
    };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(routeTextMessage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', userDefaultCurrency: 'UZS' }),
    );
    expect(reply).toHaveBeenCalledTimes(1);
  });

  describe('TASK-BOT-003 — Clarification Question Generator reply wiring', () => {
    it('a fresh candidate resolving to AWAITING_CLARIFICATION sends the real generated question, not a generic acknowledgment', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'candidate_processed',
        processEventOutcome: { status: 'transitioned', nextState: 'AWAITING_CLARIFICATION' },
        clarificationQuestion: 'How much was it?',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'spent something' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith('How much was it?');
    });

    it('a still-unresolved clarification answer sends the regenerated retry question, not a static "Thanks, updating that now" acknowledgment', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'clarification_processed',
        processEventOutcome: {
          status: 'transitioned',
          nextState: 'AWAITING_CLARIFICATION',
          fallbackToMiniForm: false,
        },
        nextQuestion:
          "I need a specific number to log this — how much, roughly? (e.g. '50000' or '50k')",
        language: 'en',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'not sure' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith(
        "I need a specific number to log this — how much, roughly? (e.g. '50000' or '50k')",
      );
    });

    it('retry budget exhausted (fallbackToMiniForm) sends the language-aware fallback message, ignoring nextQuestion entirely', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'clarification_processed',
        processEventOutcome: {
          status: 'transitioned',
          nextState: 'AWAITING_CLARIFICATION',
          fallbackToMiniForm: true,
        },
        nextQuestion: 'should be ignored',
        language: 'uz',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'not sure' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledTimes(1);
      const [sentText] = reply.mock.calls[0] as [string];
      expect(sentText).not.toBe('should be ignored');
      expect(sentText).toContain('boshqacha'); // Uzbek fallback wording
    });
  });

  it('acknowledges a voice message within the same handler before routing (FR-BOT-003)', async () => {
    const { routeVoiceMessage } = buildService();
    routeVoiceMessage.execute.mockResolvedValue({ kind: 'enqueued', jobId: 'stt-1' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }) as unknown as typeof globalThis.fetch;

    const handler = onHandlers[VOICE_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = {
      provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
      message: { voice: { file_id: 'file-1', duration: 3, mime_type: 'audio/ogg', file_size: 4 } },
      telegram: { getFileLink: vi.fn().mockResolvedValue('https://example.com/file-1.ogg') },
      reply,
    };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(reply).toHaveBeenNthCalledWith(1, expect.stringContaining('analyzing'));
    expect(routeVoiceMessage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ telegramFileId: 'file-1' }),
    );
  });

  it('routes a photo message, picking the largest PhotoSize and passing the caption through', async () => {
    const { routePhotoMessage } = buildService();
    routePhotoMessage.execute.mockResolvedValue({ kind: 'enqueued', jobId: 'ocr-1' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }) as unknown as typeof globalThis.fetch;

    const handler = onHandlers[PHOTO_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = {
      provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
      message: {
        photo: [
          { file_id: 'small', file_size: 100 },
          { file_id: 'large', file_size: 5000 },
        ],
        caption: 'lunch receipt',
      },
      telegram: { getFileLink: vi.fn().mockResolvedValue('https://example.com/large.jpg') },
      reply,
    };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(routePhotoMessage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ telegramFileId: 'large', caption: 'lunch receipt' }),
    );
  });

  it('classifies a document upload and replies without enqueuing anything (TASK-AI-007/008 not built)', async () => {
    const { routeDocumentMessage } = buildService();
    routeDocumentMessage.execute.mockReturnValue({
      kind: 'not_yet_supported',
      classification: 'pdf',
    });

    const handler = onHandlers[DOCUMENT_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = {
      provisioning: provisioning(),
      message: { document: { file_name: 'statement.pdf', mime_type: 'application/pdf' } },
      reply,
    };

    await handler(ctx);

    expect(routeDocumentMessage.execute).toHaveBeenCalledWith({
      fileName: 'statement.pdf',
      mimeType: 'application/pdf',
    });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('replies with a graceful message for an unsupported update type without reaching AI Processing Core (FR-BOT-004)', async () => {
    buildService();

    const handler = onHandlers[UNSUPPORTED_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    await handler({ provisioning: provisioning(), reply });

    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('routes a callback query through RouteCallbackQueryUseCase and answers it', async () => {
    const { routeCallbackQuery } = buildService();
    routeCallbackQuery.execute.mockResolvedValue({ kind: 'acknowledged' });

    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const answerCbQuery = vi.fn();
    const ctx = {
      provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
      callbackQuery: { data: 'confirm:txn-1' },
      answerCbQuery,
    };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(routeCallbackQuery.execute).toHaveBeenCalledWith(
      expect.objectContaining({ callbackData: 'confirm:txn-1' }),
    );
    expect(answerCbQuery).toHaveBeenCalledTimes(1);
  });

  it('answers a malformed callback query (no data) without calling RouteCallbackQueryUseCase', async () => {
    const { routeCallbackQuery } = buildService();

    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const answerCbQuery = vi.fn();
    const ctx = {
      provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
      callbackQuery: {},
      answerCbQuery,
    };

    await handler(ctx);

    expect(routeCallbackQuery.execute).not.toHaveBeenCalled();
    expect(answerCbQuery).toHaveBeenCalledTimes(1);
  });

  it('/help replies with the help message', async () => {
    buildService();
    const reply = vi.fn();

    await commandHandlers.get('help')!({ provisioning: provisioning(), reply });

    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('/cancel calls ProcessConversationEventUseCase with a CANCELLATION event', async () => {
    const { processConversationEvent } = buildService();
    processConversationEvent.execute.mockResolvedValue({ status: 'transitioned' });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('cancel')!({ provisioning: provisioning(), reply }),
    );

    expect(processConversationEvent.execute).toHaveBeenCalledWith(expect.any(String), {
      type: 'CANCELLATION',
    });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('a not-yet-implemented command (e.g. /report) replies with a placeholder rather than throwing', async () => {
    buildService();
    const reply = vi.fn();

    await commandHandlers.get('report')!({ provisioning: provisioning(), reply });

    expect(reply).toHaveBeenCalledTimes(1);
  });

  describe('TASK-FIN-003 — /budget command', () => {
    it('/budget with no args lists active budgets with their live utilization (FR-BUD-006)', async () => {
      const { listBudgets } = buildService();
      listBudgets.execute.mockResolvedValue([
        {
          budget: {
            scopeType: 'overall',
            categoryId: null,
            limitAmount: '500000.00',
            currency: 'UZS',
          },
          usedAmount: '100000.00',
          utilizationPercent: 20,
          remainingAmount: '400000.00',
          daysRemainingInPeriod: 10,
        },
      ]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('budget')!({
          provisioning: provisioning(),
          message: { text: '/budget' },
          reply,
        }),
      );

      expect(listBudgets.execute).toHaveBeenCalledWith({ userId: 'user-abc-123' });
      expect(reply).toHaveBeenCalledWith(expect.stringContaining('20.0%'));
    });

    it('/budget create <category> <amount> <period> creates a budget (FR-BUD-001/007)', async () => {
      const { createBudget, categoryRepository } = buildService();
      categoryRepository.findByCode.mockResolvedValue({ id: 'category-1', status: 'active' });
      createBudget.execute.mockResolvedValue({
        kind: 'created',
        budget: { id: 'budget-1' },
      });
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('budget')!({
          provisioning: provisioning(),
          message: { text: '/budget create FOOD_DINING 2000000 monthly' },
          reply,
        }),
      );

      expect(categoryRepository.findByCode).toHaveBeenCalledWith('FOOD_DINING');
      expect(createBudget.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: 'category',
          categoryId: 'category-1',
          limitAmount: '2000000',
          periodType: 'monthly',
        }),
      );
      expect(reply).toHaveBeenCalledWith(expect.stringContaining('✅'));
    });

    it('/budget create overall <amount> <period> creates an overall-scope budget', async () => {
      const { createBudget, categoryRepository } = buildService();
      createBudget.execute.mockResolvedValue({ kind: 'created', budget: { id: 'budget-1' } });
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('budget')!({
          provisioning: provisioning(),
          message: { text: '/budget create overall 500000 weekly' },
          reply,
        }),
      );

      expect(categoryRepository.findByCode).not.toHaveBeenCalled();
      expect(createBudget.execute).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: 'overall', categoryId: undefined }),
      );
    });

    it('replies with the duplicate-budget message (never throws) when the use case reports a scope conflict (§8.4.7)', async () => {
      const { createBudget, categoryRepository } = buildService();
      categoryRepository.findByCode.mockResolvedValue({ id: 'category-1', status: 'active' });
      createBudget.execute.mockResolvedValue({ kind: 'duplicate', existingBudgetId: 'existing-1' });
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('budget')!({
          provisioning: provisioning(),
          message: { text: '/budget create FOOD_DINING 2000000 monthly' },
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/already exists|already/i));
    });

    it('rejects an invalid period without calling the use case', async () => {
      const { createBudget } = buildService();
      const reply = vi.fn();

      await commandHandlers.get('budget')!({
        provisioning: provisioning(),
        message: { text: '/budget create FOOD_DINING 2000000 daily' },
        reply,
      });

      expect(createBudget.execute).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-numeric/zero amount without calling the use case', async () => {
      const { createBudget } = buildService();
      const reply = vi.fn();

      await commandHandlers.get('budget')!({
        provisioning: provisioning(),
        message: { text: '/budget create FOOD_DINING 0 monthly' },
        reply,
      });

      expect(createBudget.execute).not.toHaveBeenCalled();
    });

    it('replies with a not-found message for an unrecognized category code, without calling the use case', async () => {
      const { createBudget, categoryRepository } = buildService();
      categoryRepository.findByCode.mockResolvedValue(null);
      const reply = vi.fn();

      await commandHandlers.get('budget')!({
        provisioning: provisioning(),
        message: { text: '/budget create BOGUS_CODE 2000000 monthly' },
        reply,
      });

      expect(createBudget.execute).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledTimes(1);
    });

    it('shows usage guidance for a malformed /budget create invocation (wrong arg count)', async () => {
      const { createBudget } = buildService();
      const reply = vi.fn();

      await commandHandlers.get('budget')!({
        provisioning: provisioning(),
        message: { text: '/budget create FOOD_DINING' },
        reply,
      });

      expect(createBudget.execute).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledTimes(1);
    });
  });

  describe('TASK-BOT-004 — Confirmation Flow & Draft Persistence', () => {
    it('a flagged_review commit (AWAITING_CONFIRMATION) attaches the Edit/Undo inline keyboard to the confirmation message', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'candidate_processed',
        processEventOutcome: {
          status: 'transitioned',
          nextState: 'AWAITING_CONFIRMATION',
          transactionId: 'txn-1',
          flaggedFields: ['amount'],
        },
        candidate: {
          amount: 45000,
          currency: 'UZS',
          category: 'FOOD_DINING',
          merchant: null,
          transactionDate: '2026-08-14',
        },
        clarificationQuestion: null,
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'spent 45000 on lunch' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledTimes(1);
      const [text, options] = reply.mock.calls[0]!;
      expect(text).toContain('45,000 UZS');
      expect(options.reply_markup.inline_keyboard.flat()).toContainEqual({
        text: '↩️ Undo',
        callback_data: 'undo:txn-1',
      });
    });

    it('an auto_commit candidate (IDLE) gets the real confirmation text but NO inline keyboard (state machine cannot honor Edit/Undo from IDLE)', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'candidate_processed',
        processEventOutcome: {
          status: 'transitioned',
          nextState: 'IDLE',
          transactionId: 'txn-2',
          flaggedFields: [],
        },
        candidate: {
          amount: 45000,
          currency: 'UZS',
          category: 'FOOD_DINING',
          merchant: null,
          transactionDate: '2026-08-14',
        },
        clarificationQuestion: null,
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'spent 45000 on lunch' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledTimes(1);
      const [text, options] = reply.mock.calls[0]!;
      expect(text).toContain('45,000 UZS');
      expect(options).toBeUndefined();
    });

    it('an "undone" callback outcome replies with the Undo confirmation text', async () => {
      const { routeCallbackQuery } = buildService();
      routeCallbackQuery.execute.mockResolvedValue({
        kind: 'undone',
        processEventOutcome: { status: 'transitioned' },
      });

      const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const answerCbQuery = vi.fn();
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        callbackQuery: { data: 'undo:txn-1' },
        answerCbQuery,
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(answerCbQuery).toHaveBeenCalledTimes(1);
      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/undone/i));
    });

    it('a stale "undone" outcome (state already moved on) replies with the stale message, not a false success', async () => {
      const { routeCallbackQuery } = buildService();
      routeCallbackQuery.execute.mockResolvedValue({
        kind: 'undone',
        processEventOutcome: { status: 'rejected', requirementId: null, reason: 'stale' },
      });

      const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        callbackQuery: { data: 'undo:txn-1' },
        answerCbQuery: vi.fn(),
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).not.toHaveBeenCalledWith(expect.stringMatching(/undone/i));
    });

    it("/drafts lists the user's pending drafts with real amount/category, most recent first", async () => {
      const { listDrafts } = buildService();
      listDrafts.execute.mockResolvedValue([
        {
          id: 'd1',
          userId: 'user-abc-123',
          partialData: { amount: 45000, currency: 'UZS', category: 'FOOD_DINING' },
          missingFields: [],
          status: 'pending',
          originalText: 'lunch',
          sourceType: 'text',
          resolvedTransactionId: null,
          createdAt: new Date(),
          lastInteractionAt: new Date(),
          deletedAt: null,
        },
      ]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('drafts')!({ provisioning: provisioning(), reply }),
      );

      expect(listDrafts.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-abc-123' }),
      );
      const [text] = reply.mock.calls[0]!;
      expect(text).toContain('45,000 UZS');
      expect(text).toContain('FOOD_DINING');
    });

    it('/drafts with nothing pending replies with a clear "no drafts" message, not an empty list', async () => {
      const { listDrafts } = buildService();
      listDrafts.execute.mockResolvedValue([]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('drafts')!({ provisioning: provisioning(), reply }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/don't have any pending/i));
    });
  });

  describe('TASK-FIN-002 — /debts command (FR-DBT-006)', () => {
    it("/debts lists the user's open debts, grouped by given/received direction", async () => {
      const { listOpenDebts } = buildService();
      listOpenDebts.execute.mockResolvedValue([
        {
          direction: 'given',
          counterpartyName: 'Aziz',
          outstandingBalance: '50000.00',
          currency: 'UZS',
          dueDate: new Date('2026-09-01'),
        },
        {
          direction: 'received',
          counterpartyName: 'Dilnoza',
          outstandingBalance: '20000.00',
          currency: 'UZS',
          dueDate: null,
        },
      ]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('debts')!({ provisioning: provisioning(), reply }),
      );

      expect(listOpenDebts.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-abc-123' }),
      );
      const [text] = reply.mock.calls[0]!;
      expect(text).toContain('Aziz');
      expect(text).toContain('50000.00 UZS');
      expect(text).toContain('Dilnoza');
      expect(text).toContain('20000.00 UZS');
    });

    it('/debts with no open debts replies with a clear empty-state message, not an empty list', async () => {
      const { listOpenDebts } = buildService();
      listOpenDebts.execute.mockResolvedValue([]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('debts')!({ provisioning: provisioning(), reply }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/don't have any open debts/i));
    });

    it('/debts sorts due-dated debts soonest-first within each direction (the repository already returns them in that order; this proves the renderer does not re-shuffle them)', async () => {
      const { listOpenDebts } = buildService();
      listOpenDebts.execute.mockResolvedValue([
        {
          direction: 'given',
          counterpartyName: 'SoonerDebt',
          outstandingBalance: '10000.00',
          currency: 'UZS',
          dueDate: new Date('2026-09-01'),
        },
        {
          direction: 'given',
          counterpartyName: 'LaterDebt',
          outstandingBalance: '20000.00',
          currency: 'UZS',
          dueDate: new Date('2026-12-01'),
        },
      ]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('debts')!({ provisioning: provisioning(), reply }),
      );

      const [text] = reply.mock.calls[0]!;
      expect(text.indexOf('SoonerDebt')).toBeLessThan(text.indexOf('LaterDebt'));
    });

    it("/debts never leaks another user's debts — scopes strictly by the resolved ALS user id", async () => {
      const { listOpenDebts } = buildService();
      listOpenDebts.execute.mockResolvedValue([]);
      const reply = vi.fn();

      await runWithUserContext('user-other-999', () =>
        commandHandlers.get('debts')!({ provisioning: provisioning(), reply }),
      );

      expect(listOpenDebts.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-other-999' }),
      );
    });
  });

  describe('TASK-REP-004 — /dashboard command (FR-DSH-001/002/004)', () => {
    it('/dashboard renders the full summary when the use case returns real data', async () => {
      const { generateDashboard } = buildService();
      generateDashboard.execute.mockResolvedValue({
        kind: 'summary',
        periodKey: '2026-08',
        totalExpense: '300000.00',
        totalIncome: '1000000.00',
        netCashFlow: '700000.00',
        topCategories: [{ categoryId: 'food', totalAmount: '150000.00' }],
        overallBudgetUtilization: {
          usedAmount: '200000.00',
          utilizationPercent: 20,
          budget: { limitAmount: '1000000.00', currency: 'UZS' },
        },
        openDebtsGiven: {
          count: 1,
          totalOutstandingByCurrency: [{ currency: 'UZS', totalOutstanding: '50000.00' }],
        },
        openDebtsReceived: { count: 0, totalOutstandingByCurrency: [] },
        pendingDraftCount: 2,
      });
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('dashboard')!({ provisioning: provisioning(), reply }),
      );

      expect(generateDashboard.execute).toHaveBeenCalledWith('user-abc-123');
      const [text] = reply.mock.calls[0]!;
      expect(text).toContain('300000.00');
      expect(text).toContain('1000000.00');
      expect(text).toContain('700000.00');
      expect(text).toContain('food');
      expect(text).toContain('50000.00 UZS');
      expect(text).toContain('2');
    });

    it('/dashboard replies with a friendly onboarding message for a brand-new user, never a wall of zeros', async () => {
      const { generateDashboard } = buildService();
      generateDashboard.execute.mockResolvedValue({ kind: 'empty' });
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('dashboard')!({ provisioning: provisioning(), reply }),
      );

      const [text] = reply.mock.calls[0]!;
      expect(text).not.toContain('0.00');
      expect(text.length).toBeGreaterThan(0);
    });

    it("/dashboard never leaks another user's data — scopes strictly by the resolved ALS user id", async () => {
      const { generateDashboard } = buildService();
      generateDashboard.execute.mockResolvedValue({ kind: 'empty' });
      const reply = vi.fn();

      await runWithUserContext('user-other-999', () =>
        commandHandlers.get('dashboard')!({ provisioning: provisioning(), reply }),
      );

      expect(generateDashboard.execute).toHaveBeenCalledWith('user-other-999');
    });
  });

  describe('TASK-FIN-012 — /search command (FR-SCH-001/003/004)', () => {
    it('/search starts a fresh session and shows the filter menu keyboard', async () => {
      const { searchSessionRepository } = buildService();
      searchSessionRepository.get.mockResolvedValue(null);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('search')!({ provisioning: provisioning(), reply }),
      );

      expect(searchSessionRepository.compareAndSet).toHaveBeenCalledWith(
        'user-abc-123',
        0,
        expect.objectContaining({ version: 1, filters: {}, awaitingField: null, page: 0 }),
      );
      const [text, extra] = reply.mock.calls[0]!;
      expect(text).toContain('filter');
      expect(extra.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
    });

    it('tapping a text-style filter button (e.g. Merchant) sets awaitingField and prompts for input', async () => {
      const { searchSessionRepository } = buildService();
      searchSessionRepository.get.mockResolvedValue({
        version: 3,
        filters: {},
        awaitingField: null,
        page: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      searchSessionRepository.compareAndSet.mockResolvedValue(true);
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_field:merchant' },
          answerCbQuery,
          reply,
        }),
      );

      expect(searchSessionRepository.compareAndSet).toHaveBeenCalledWith(
        'user-abc-123',
        3,
        expect.objectContaining({ awaitingField: 'merchant', version: 4 }),
      );
      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/merchant/i));
    });

    it('tapping a Type button sets the filter directly, with no text step', async () => {
      const { searchSessionRepository } = buildService();
      searchSessionRepository.get.mockResolvedValue({
        version: 1,
        filters: {},
        awaitingField: null,
        page: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      searchSessionRepository.compareAndSet.mockResolvedValue(true);
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_type:EXPENSE' },
          answerCbQuery,
          reply,
        }),
      );

      expect(searchSessionRepository.compareAndSet).toHaveBeenCalledWith(
        'user-abc-123',
        1,
        expect.objectContaining({
          version: 2,
          filters: expect.objectContaining({ transactionType: 'EXPENSE' }),
          awaitingField: null,
        }),
      );
    });

    it('a plain-text answer while awaitingField is set writes the filter and re-shows the menu, never reaching the AI pipeline', async () => {
      const { searchSessionRepository, routeTextMessage } = buildService();
      searchSessionRepository.get.mockResolvedValue({
        version: 2,
        filters: {},
        awaitingField: 'merchant',
        page: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      searchSessionRepository.compareAndSet.mockResolvedValue(true);
      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: provisioning(),
        message: { text: 'Korzinka' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(searchSessionRepository.compareAndSet).toHaveBeenCalledWith(
        'user-abc-123',
        2,
        expect.objectContaining({ filters: { merchant: 'Korzinka' }, awaitingField: null }),
      );
      expect(routeTextMessage.execute).not.toHaveBeenCalled();
    });

    it('search_apply runs the search under the authenticated user id and renders results with a Delete button per row', async () => {
      const { searchSessionRepository, searchTransactions } = buildService();
      searchSessionRepository.get.mockResolvedValue({
        version: 5,
        filters: { merchant: 'Korzinka' },
        awaitingField: null,
        page: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      searchSessionRepository.compareAndSet.mockResolvedValue(true);
      searchTransactions.execute.mockResolvedValue({
        results: [
          {
            id: 'txn-1',
            amount: '15000.00',
            currency: 'UZS',
            transactionType: 'EXPENSE',
            categoryId: 'FOOD_DINING',
            merchant: 'Korzinka',
            transactionDate: new Date('2026-03-01'),
            description: 'groceries',
          },
        ],
        totalCount: 1,
        page: 0,
        pageSize: 5,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_apply' },
          answerCbQuery,
          reply,
        }),
      );

      expect(searchTransactions.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-abc-123', page: 0 }),
      );
      const [text, extra] = reply.mock.calls[0]!;
      expect(text).toContain('Korzinka');
      expect(
        extra.reply_markup.inline_keyboard.some((row: unknown[]) =>
          row.some(
            (btn) => (btn as { callback_data: string }).callback_data === 'search_delete:txn-1',
          ),
        ),
      ).toBe(true);
    });

    it('search_apply with no results shows the friendly empty-state message, never a raw empty list', async () => {
      const { searchSessionRepository, searchTransactions } = buildService();
      searchSessionRepository.get.mockResolvedValue({
        version: 1,
        filters: {},
        awaitingField: null,
        page: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      searchSessionRepository.compareAndSet.mockResolvedValue(true);
      searchTransactions.execute.mockResolvedValue({
        results: [],
        totalCount: 0,
        page: 0,
        pageSize: 5,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_apply' },
          answerCbQuery,
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/nothing found|hech narsa/i));
    });

    it('search_delete calls DeleteTransactionUseCase with the AUTHENTICATED caller id, never a value from callback_data', async () => {
      const { deleteTransactionUseCase } = buildService();
      deleteTransactionUseCase.execute.mockResolvedValue({ id: 'txn-1' });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const answerCbQuery = vi.fn();
      const reply = vi.fn();

      await runWithUserContext('user-other-999', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_delete:txn-1' },
          answerCbQuery,
          reply,
        }),
      );

      expect(deleteTransactionUseCase.execute).toHaveBeenCalledWith({
        transactionId: 'txn-1',
        userId: 'user-other-999',
      });
    });

    it("search_delete on another user's transaction — rejected by DeleteTransactionUseCase — surfaces a clean message, not an unhandled error", async () => {
      const { deleteTransactionUseCase } = buildService();
      const { UnauthorizedTransactionAccessError } = await import('@afa/application');
      deleteTransactionUseCase.execute.mockImplementation(() => {
        throw new UnauthorizedTransactionAccessError('txn-1', 'user-abc-123');
      });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const answerCbQuery = vi.fn();
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_delete:txn-1' },
          answerCbQuery,
          reply,
        }),
      );

      expect(answerCbQuery).toHaveBeenCalledWith(
        expect.stringMatching(/already deleted|no longer exists|topilmadi|удалена/i),
      );
    });

    it('search_cancel deletes the session and confirms cancellation', async () => {
      const { searchSessionRepository } = buildService();
      searchSessionRepository.get.mockResolvedValue({
        version: 2,
        filters: { merchant: 'x' },
        awaitingField: null,
        page: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      searchSessionRepository.compareAndSet.mockResolvedValue(true);
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'search_cancel' },
          answerCbQuery,
          reply,
        }),
      );

      expect(searchSessionRepository.compareAndSet).toHaveBeenCalledWith('user-abc-123', 2, null);
    });
  });

  describe('TASK-AUTH-006 — /deleteaccount command (FR-RET-001/003)', () => {
    it('/deleteaccount reaches the confirmation prompt with Yes/Cancel buttons', async () => {
      buildService();
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('deleteaccount')!({ provisioning: provisioning(), reply }),
      );

      const [text, extra] = reply.mock.calls[0]!;
      expect(text).toContain('30');
      expect(
        extra.reply_markup.inline_keyboard
          .flat()
          .map((b: { callback_data: string }) => b.callback_data),
      ).toEqual(expect.arrayContaining(['delacct_confirm', 'delacct_cancel']));
    });

    it('tapping "Yes" marks the awaiting-confirmation flag and prompts to type DELETE', async () => {
      const { accountDeletionConfirmationRepository } = buildService();
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'delacct_confirm' },
          answerCbQuery,
          reply,
        }),
      );

      expect(accountDeletionConfirmationRepository.markAwaitingConfirmation).toHaveBeenCalledWith(
        'user-abc-123',
        expect.any(Date),
      );
      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/DELETE/));
    });

    it('tapping "Cancel" declines the request outright — no flag set, no state change', async () => {
      const { accountDeletionConfirmationRepository } = buildService();
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'delacct_cancel' },
          answerCbQuery,
          reply,
        }),
      );

      expect(accountDeletionConfirmationRepository.markAwaitingConfirmation).not.toHaveBeenCalled();
    });

    it('wrong text while awaiting confirmation does NOT request deletion, clears the flag, and never reaches the AI pipeline', async () => {
      const { accountDeletionConfirmationRepository, requestAccountDeletion, routeTextMessage } =
        buildService();
      accountDeletionConfirmationRepository.isAwaitingConfirmation.mockResolvedValue(true);
      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = { provisioning: provisioning(), message: { text: 'delete' }, reply };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(accountDeletionConfirmationRepository.clear).toHaveBeenCalledWith('user-abc-123');
      expect(requestAccountDeletion.execute).not.toHaveBeenCalled();
      expect(routeTextMessage.execute).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledWith(
        expect.stringMatching(/not.*confirmed|unchanged|bekor|отмен/i),
      );
    });

    it('the exact literal "DELETE" requests deletion under the authenticated user id and confirms success', async () => {
      const { accountDeletionConfirmationRepository, requestAccountDeletion } = buildService();
      accountDeletionConfirmationRepository.isAwaitingConfirmation.mockResolvedValue(true);
      requestAccountDeletion.execute.mockResolvedValue({ kind: 'requested' });
      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = { provisioning: provisioning(), message: { text: 'DELETE' }, reply };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(requestAccountDeletion.execute).toHaveBeenCalledWith('user-abc-123');
      expect(reply).toHaveBeenCalledWith(
        expect.stringMatching(/30/),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: [
              [expect.objectContaining({ callback_data: 'delacct_cancel_pending' })],
            ],
          }),
        }),
      );
    });

    it('never leaks another user — the confirmed deletion request always uses the ALS-resolved id, never a client-supplied one', async () => {
      const { accountDeletionConfirmationRepository, requestAccountDeletion } = buildService();
      accountDeletionConfirmationRepository.isAwaitingConfirmation.mockResolvedValue(true);
      requestAccountDeletion.execute.mockResolvedValue({ kind: 'requested' });
      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = { provisioning: provisioning(), message: { text: 'DELETE' }, reply };

      await runWithUserContext('user-other-999', () => handler(ctx));

      expect(requestAccountDeletion.execute).toHaveBeenCalledWith('user-other-999');
    });

    it('reports a neutral, honest status when the account is not eligible (already pending deletion), inventing no new policy', async () => {
      const { accountDeletionConfirmationRepository, requestAccountDeletion } = buildService();
      accountDeletionConfirmationRepository.isAwaitingConfirmation.mockResolvedValue(true);
      requestAccountDeletion.execute.mockResolvedValue({
        kind: 'not_eligible',
        currentStatus: 'pending_deletion',
      });
      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = { provisioning: provisioning(), message: { text: 'DELETE' }, reply };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('pending_deletion'));
    });

    it('FR-RET-001 — a pending_deletion user is blocked from ALL bot functionality before any handler runs', async () => {
      const { provisionTelegramUser } = buildService();
      provisionTelegramUser.execute.mockResolvedValue({
        user: {
          id: 'user-abc-123',
          timezone: 'Asia/Tashkent',
          defaultCurrency: 'UZS',
          preferredLanguage: 'en',
          status: 'pending_deletion',
        },
        isNewUser: false,
      });
      const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
      const reply = vi.fn();
      let nextCalled = false;
      const ctx = { from: { id: 42, username: 'ada' }, reply };
      const next = async () => {
        nextCalled = true;
      };

      await authMiddleware(ctx, next);

      expect(nextCalled).toBe(false);
      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/pending deletion|suspend/i));
    });

    it('a "deleted" user is likewise blocked from all bot functionality', async () => {
      const { provisionTelegramUser } = buildService();
      provisionTelegramUser.execute.mockResolvedValue({
        user: {
          id: 'user-abc-123',
          timezone: 'Asia/Tashkent',
          defaultCurrency: 'UZS',
          preferredLanguage: 'en',
          status: 'deleted',
        },
        isNewUser: false,
      });
      const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
      const reply = vi.fn();
      let nextCalled = false;
      const ctx = { from: { id: 42, username: 'ada' }, reply };
      const next = async () => {
        nextCalled = true;
      };

      await authMiddleware(ctx, next);

      expect(nextCalled).toBe(false);
      expect(reply).toHaveBeenCalledTimes(1);
    });

    it('an active user is never blocked — regression guard for the new middleware branch', async () => {
      const { provisionTelegramUser } = buildService();
      provisionTelegramUser.execute.mockResolvedValue({
        user: {
          id: 'user-abc-123',
          timezone: 'Asia/Tashkent',
          defaultCurrency: 'UZS',
          preferredLanguage: 'en',
          status: 'active',
        },
        isNewUser: false,
      });
      const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
      let nextCalled = false;
      const ctx = { from: { id: 42, username: 'ada' }, reply: vi.fn() };
      const next = async () => {
        nextCalled = true;
      };

      await authMiddleware(ctx, next);

      expect(nextCalled).toBe(true);
    });

    it('a repeated /deleteaccount while pending_deletion reaches the command handler (middleware exception) — no new request, an honest status/grace-period report instead', async () => {
      const { provisionTelegramUser, requestAccountDeletion } = buildService();
      const deletionRequestedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago -> 25 remaining
      provisionTelegramUser.execute.mockResolvedValue({
        user: {
          id: 'user-abc-123',
          timezone: 'Asia/Tashkent',
          defaultCurrency: 'UZS',
          preferredLanguage: 'en',
          status: 'pending_deletion',
          deletionRequestedAt,
        },
        isNewUser: false,
      });
      const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
      const reply = vi.fn();
      let nextCalled = false;
      const ctx = {
        from: { id: 42, username: 'ada' },
        message: { text: '/deleteaccount' },
        reply,
      };

      await authMiddleware(ctx, async () => {
        nextCalled = true;
      });

      // The middleware itself must let this one through instead of blocking it.
      expect(nextCalled).toBe(true);
      expect(reply).not.toHaveBeenCalled();

      const commandReply = vi.fn();
      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('deleteaccount')!({
          provisioning: provisioning({
            status: 'pending_deletion',
            deletionRequestedAt,
          }),
          reply: commandReply,
        }),
      );

      expect(requestAccountDeletion.execute).not.toHaveBeenCalled();
      const [text, extra] = commandReply.mock.calls[0]!;
      expect(text).toMatch(/25/);
      expect(
        extra.reply_markup.inline_keyboard
          .flat()
          .map((b: { callback_data: string }) => b.callback_data),
      ).toEqual(['delacct_cancel_pending']);
    });

    it('the "Cancel account deletion" button reaches its handler while pending_deletion (the other middleware exception)', async () => {
      const { provisionTelegramUser, cancelAccountDeletion } = buildService();
      cancelAccountDeletion.execute.mockResolvedValue({ kind: 'cancelled' });
      provisionTelegramUser.execute.mockResolvedValue({
        user: {
          id: 'user-abc-123',
          timezone: 'Asia/Tashkent',
          defaultCurrency: 'UZS',
          preferredLanguage: 'en',
          status: 'pending_deletion',
          deletionRequestedAt: new Date(),
        },
        isNewUser: false,
      });
      const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
      const reply = vi.fn();
      let nextCalled = false;
      const ctx = {
        from: { id: 42, username: 'ada' },
        callbackQuery: { data: 'delacct_cancel_pending' },
        reply,
      };

      await authMiddleware(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(reply).not.toHaveBeenCalled();
    });

    it('cancelling within the grace period restores full access — CancelAccountDeletionUseCase is invoked with the ALS-resolved user id, never one carried in callback_data', async () => {
      const { cancelAccountDeletion } = buildService();
      cancelAccountDeletion.execute.mockResolvedValue({ kind: 'cancelled' });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'delacct_cancel_pending' },
          answerCbQuery,
          reply,
        }),
      );

      expect(cancelAccountDeletion.execute).toHaveBeenCalledWith('user-abc-123', expect.any(Date));
      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/cancel/i));
    });

    it('a stale "Cancel account deletion" tap always resolves the CURRENT clicking user via ALS, never a different user — cross-user isolation', async () => {
      const { cancelAccountDeletion } = buildService();
      cancelAccountDeletion.execute.mockResolvedValue({ kind: 'cancelled' });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      // callback_data carries no id at all — the same fixed literal every
      // "Cancel account deletion" button ever sends, old or fresh.
      await runWithUserContext('user-someone-else-999', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'delacct_cancel_pending' },
          answerCbQuery,
          reply,
        }),
      );

      expect(cancelAccountDeletion.execute).toHaveBeenCalledWith(
        'user-someone-else-999',
        expect.any(Date),
      );
      expect(cancelAccountDeletion.execute).not.toHaveBeenCalledWith(
        'user-abc-123',
        expect.anything(),
      );
    });

    it('cancelling after the grace period has expired reports it can no longer be cancelled', async () => {
      const { cancelAccountDeletion } = buildService();
      cancelAccountDeletion.execute.mockResolvedValue({ kind: 'grace_period_expired' });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'delacct_cancel_pending' },
          answerCbQuery,
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith(
        expect.stringMatching(/30-day|already.*end|already ended/i),
      );
    });

    it('cancelling when there is no deletion request at all (e.g. already purged and silently re-provisioned) reports the real current status, not a false success', async () => {
      const { cancelAccountDeletion } = buildService();
      cancelAccountDeletion.execute.mockResolvedValue({
        kind: 'not_pending',
        currentStatus: 'active',
      });
      const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const answerCbQuery = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        callbackHandler({
          provisioning: provisioning(),
          callbackQuery: { data: 'delacct_cancel_pending' },
          answerCbQuery,
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('active'));
    });
  });

  describe('TASK-FIN-004 Stage I — /loans command', () => {
    function loanFixture(overrides: Record<string, unknown> = {}) {
      return {
        id: 'loan-1',
        lender: 'Ipoteka Bank',
        principalAmount: '1000000.00',
        outstandingBalance: '1000000.00',
        currency: 'UZS',
        interestRate: '0.1200',
        installmentAmount: '90000.00',
        installmentFrequency: 'monthly',
        startDate: new Date('2026-01-01'),
        status: 'open',
        ...overrides,
      };
    }

    it('/loans with no args lists open loans with lender, balance, installment, and next due date (FR-FIN-009)', async () => {
      const { listOpenLoans } = buildService();
      listOpenLoans.execute.mockResolvedValue([loanFixture()]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('loans')!({
          provisioning: provisioning(),
          message: { text: '/loans' },
          reply,
        }),
      );

      expect(listOpenLoans.execute).toHaveBeenCalledWith({ userId: 'user-abc-123' });
      const [text] = reply.mock.calls[0]!;
      expect(text).toContain('Ipoteka Bank');
      expect(text).toContain('1000000.00 UZS');
      expect(text).toContain('90000.00 UZS');
    });

    it('/loans with no open loans replies with a clear empty-state message', async () => {
      const { listOpenLoans } = buildService();
      listOpenLoans.execute.mockResolvedValue([]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('loans')!({
          provisioning: provisioning(),
          message: { text: '/loans' },
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('loans create'));
    });

    it('/loans <id> shows the details of an existing loan', async () => {
      const { listOpenLoans } = buildService();
      listOpenLoans.execute.mockResolvedValue([loanFixture({ id: 'loan-42' })]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('loans')!({
          provisioning: provisioning(),
          message: { text: '/loans loan-42' },
          reply,
        }),
      );

      const [text] = reply.mock.calls[0]!;
      expect(text).toContain('Ipoteka Bank');
      expect(text).toContain('0.1200');
    });

    it('/loans <id> replies with a not-found message for a nonexistent/foreign loan id', async () => {
      const { listOpenLoans } = buildService();
      listOpenLoans.execute.mockResolvedValue([]);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('loans')!({
          provisioning: provisioning(),
          message: { text: '/loans nonexistent' },
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('No matching loan found'));
    });

    describe('/loans create wizard', () => {
      it('starts the wizard by writing AWAITING_LENDER and asking for the lender', async () => {
        const { loanWizardStateRepository } = buildService();
        loanWizardStateRepository.get.mockResolvedValue(null);
        const reply = vi.fn();

        await runWithUserContext('user-abc-123', () =>
          commandHandlers.get('loans')!({
            provisioning: provisioning(),
            message: { text: '/loans create' },
            reply,
          }),
        );

        expect(loanWizardStateRepository.compareAndSet).toHaveBeenCalledWith(
          'user-abc-123',
          0,
          expect.objectContaining({ step: 'AWAITING_LENDER', version: 1 }),
        );
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('lender'));
      });

      it('walks the full create flow end to end (lender -> principal -> currency -> interest -> installment -> frequency -> startDate -> confirmation) and converts a typed percent to the decimal-fraction convention', async () => {
        const { loanWizardStateRepository, currencyRepository } = buildService();
        currencyRepository.isSupported.mockResolvedValue(true);
        const textHandler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const baseCtx = { provisioning: provisioning(), reply };

        let state: LoanWizardStateRecord | null = null;
        loanWizardStateRepository.get.mockImplementation(async () => state);
        loanWizardStateRepository.compareAndSet.mockImplementation(
          async (_userId: string, _expected: number, record: LoanWizardStateRecord | null) => {
            state = record;
            return true;
          },
        );

        await runWithUserContext('user-abc-123', () =>
          commandHandlers.get('loans')!({ ...baseCtx, message: { text: '/loans create' } }),
        );
        expect(state!.step).toBe('AWAITING_LENDER');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: 'Ipoteka Bank' } }),
        );
        expect(state!.step).toBe('AWAITING_PRINCIPAL');
        expect(state!.createDraft!.lender).toBe('Ipoteka Bank');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: '1000000.00' } }),
        );
        expect(state!.step).toBe('AWAITING_CURRENCY');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: 'UZS' } }),
        );
        expect(state!.step).toBe('AWAITING_INTEREST_RATE');
        expect(currencyRepository.isSupported).toHaveBeenCalledWith('UZS');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: '12' } }),
        );
        expect(state!.step).toBe('AWAITING_INSTALLMENT_AMOUNT');
        // the core Stage F/Stage I contract: "12" (percent) becomes "0.1200" (decimal fraction), never left as "12".
        expect(state!.createDraft!.interestRate).toBe('0.1200');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: '90000.00' } }),
        );
        expect(state!.step).toBe('AWAITING_INSTALLMENT_FREQUENCY');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: 'monthly' } }),
        );
        expect(state!.step).toBe('AWAITING_START_DATE');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: '2026-01-01' } }),
        );
        expect(state!.step).toBe('AWAITING_CREATE_CONFIRMATION');

        const [text, options] = reply.mock.calls.at(-1)!;
        expect(text).toContain('Ipoteka Bank');
        expect(text).toContain('0.1200');
        expect(options.reply_markup.inline_keyboard[0][0].callback_data).toBe(
          `loan_wizard_create_confirm:${state!.version}`,
        );
      });

      it('rejects an unsupported currency and stays on the same step, without advancing the draft', async () => {
        const { loanWizardStateRepository, currencyRepository } = buildService();
        currencyRepository.isSupported.mockResolvedValue(false);
        const textHandler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
        const reply = vi.fn();

        loanWizardStateRepository.get.mockResolvedValue({
          version: 3,
          step: 'AWAITING_CURRENCY',
          createDraft: { lender: 'X', principalAmount: '100.00' },
          paymentDraft: null,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });

        await runWithUserContext('user-abc-123', () =>
          textHandler({ provisioning: provisioning(), message: { text: 'ZZZ' }, reply }),
        );

        expect(loanWizardStateRepository.compareAndSet).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith(expect.stringContaining("isn't recognized"));
      });

      it('confirming the wizard clears the state FIRST (idempotency guard), then calls CreateLoanUseCase with the collected draft', async () => {
        const { loanWizardStateRepository, createLoan } = buildService();
        const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const answerCbQuery = vi.fn();

        const draft = {
          lender: 'Ipoteka Bank',
          principalAmount: '1000000.00',
          currency: 'UZS',
          interestRate: '0.1200',
          installmentAmount: '90000.00',
          installmentFrequency: 'monthly',
          startDate: '2026-01-01',
        };
        loanWizardStateRepository.get.mockResolvedValue({
          version: 8,
          step: 'AWAITING_CREATE_CONFIRMATION',
          createDraft: draft,
          paymentDraft: null,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
        loanWizardStateRepository.compareAndSet.mockResolvedValue(true);
        createLoan.execute.mockResolvedValue({ id: 'loan-new' });

        await runWithUserContext('user-abc-123', () =>
          callbackHandler({
            provisioning: provisioning(),
            callbackQuery: { data: 'loan_wizard_create_confirm:8' },
            answerCbQuery,
            reply,
          }),
        );

        // Idempotency: the wizard is cleared via CAS on the exact observed
        // version BEFORE CreateLoanUseCase is ever called.
        expect(loanWizardStateRepository.compareAndSet).toHaveBeenCalledWith(
          'user-abc-123',
          8,
          null,
        );
        expect(createLoan.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            lender: 'Ipoteka Bank',
            principalAmount: '1000000.00',
            currency: 'UZS',
            interestRate: '0.1200',
            installmentAmount: '90000.00',
            installmentFrequency: 'monthly',
          }),
        );
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('✅'));
      });

      it('a stale/duplicate confirmation tap (version no longer matches) is rejected without calling CreateLoanUseCase (duplicate-submission guard)', async () => {
        const { loanWizardStateRepository, createLoan } = buildService();
        const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const answerCbQuery = vi.fn();

        // The wizard was already cleared (e.g. the first tap already
        // processed it) — get() returns null now.
        loanWizardStateRepository.get.mockResolvedValue(null);

        await runWithUserContext('user-abc-123', () =>
          callbackHandler({
            provisioning: provisioning(),
            callbackQuery: { data: 'loan_wizard_create_confirm:8' },
            answerCbQuery,
            reply,
          }),
        );

        expect(createLoan.execute).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledTimes(1);
      });

      it('cancelling via the inline keyboard clears the wizard and calls neither CreateLoanUseCase nor LogLoanPaymentUseCase', async () => {
        const { loanWizardStateRepository, createLoan } = buildService();
        const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const answerCbQuery = vi.fn();

        loanWizardStateRepository.get.mockResolvedValue({
          version: 4,
          step: 'AWAITING_CREATE_CONFIRMATION',
          createDraft: { lender: 'X' },
          paymentDraft: null,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
        loanWizardStateRepository.compareAndSet.mockResolvedValue(true);

        await runWithUserContext('user-abc-123', () =>
          callbackHandler({
            provisioning: provisioning(),
            callbackQuery: { data: 'loan_wizard_create_cancel:4' },
            answerCbQuery,
            reply,
          }),
        );

        expect(loanWizardStateRepository.compareAndSet).toHaveBeenCalledWith(
          'user-abc-123',
          4,
          null,
        );
        expect(createLoan.execute).not.toHaveBeenCalled();
      });
    });

    describe('/loans pay wizard', () => {
      it('with no open loans, replies with a clear message and never starts a wizard', async () => {
        const { listOpenLoans, loanWizardStateRepository } = buildService();
        listOpenLoans.execute.mockResolvedValue([]);
        const reply = vi.fn();

        await runWithUserContext('user-abc-123', () =>
          commandHandlers.get('loans')!({
            provisioning: provisioning(),
            message: { text: '/loans pay' },
            reply,
          }),
        );

        expect(loanWizardStateRepository.compareAndSet).not.toHaveBeenCalled();
      });

      it('selection -> amount -> confirmation, then applies the payment and renders amount/interest/principal/outstanding/paid_off', async () => {
        const { loanWizardStateRepository, listOpenLoans, logLoanPayment } = buildService();
        const textHandler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
        const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const answerCbQuery = vi.fn();
        const baseCtx = { provisioning: provisioning(), reply };

        listOpenLoans.execute.mockResolvedValue([loanFixture({ id: 'loan-9' })]);

        let state: LoanWizardStateRecord | null = null;
        loanWizardStateRepository.get.mockImplementation(async () => state);
        loanWizardStateRepository.compareAndSet.mockImplementation(
          async (_userId: string, _expected: number, record: LoanWizardStateRecord | null) => {
            state = record;
            return true;
          },
        );

        await runWithUserContext('user-abc-123', () =>
          commandHandlers.get('loans')!({ ...baseCtx, message: { text: '/loans pay' } }),
        );
        expect(state!.step).toBe('AWAITING_PAYMENT_LOAN_SELECTION');
        expect(state!.paymentDraft!.candidateLoanIds).toEqual(['loan-9']);

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: '1' } }),
        );
        expect(state!.step).toBe('AWAITING_PAYMENT_AMOUNT');
        expect(state!.paymentDraft!.loanId).toBe('loan-9');

        await runWithUserContext('user-abc-123', () =>
          textHandler({ ...baseCtx, message: { text: '90000.00' } }),
        );
        expect(state!.step).toBe('AWAITING_PAYMENT_CONFIRMATION');
        expect(state!.paymentDraft!.amount).toBe('90000.00');

        logLoanPayment.execute.mockResolvedValue({
          kind: 'applied',
          loan: { outstandingBalance: '920000.00', currency: 'UZS', status: 'open' },
          payment: { amount: '90000.00', principalPortion: '80000.00' },
        });

        const confirmVersion = state!.version;
        await runWithUserContext('user-abc-123', () =>
          callbackHandler({
            ...baseCtx,
            callbackQuery: { data: `loan_wizard_pay_confirm:${confirmVersion}` },
            answerCbQuery,
          }),
        );

        expect(logLoanPayment.execute).toHaveBeenCalledWith(
          expect.objectContaining({ userId: 'user-abc-123', loanId: 'loan-9', amount: '90000.00' }),
        );
        const [resultText] = reply.mock.calls.at(-1)!;
        expect(resultText).toContain('90000.00 UZS'); // payment
        expect(resultText).toContain('10000.00 UZS'); // interest portion = 90000 - 80000
        expect(resultText).toContain('80000.00 UZS'); // principal portion
        expect(resultText).toContain('920000.00 UZS'); // remaining balance
      });

      it('an invalid selection number is rejected without advancing the wizard', async () => {
        const { loanWizardStateRepository } = buildService();
        const textHandler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
        const reply = vi.fn();

        loanWizardStateRepository.get.mockResolvedValue({
          version: 2,
          step: 'AWAITING_PAYMENT_LOAN_SELECTION',
          createDraft: null,
          paymentDraft: { candidateLoanIds: ['loan-9'] },
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });

        await runWithUserContext('user-abc-123', () =>
          textHandler({ provisioning: provisioning(), message: { text: '99' }, reply }),
        );

        expect(loanWizardStateRepository.compareAndSet).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('one of the numbers'));
      });

      it('LoanOverpaymentError from LogLoanPaymentUseCase is translated to the overpayment-rejected reply, never a thrown error', async () => {
        const { loanWizardStateRepository, logLoanPayment } = buildService();
        const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const answerCbQuery = vi.fn();

        loanWizardStateRepository.get.mockResolvedValue({
          version: 5,
          step: 'AWAITING_PAYMENT_CONFIRMATION',
          createDraft: null,
          paymentDraft: { loanId: 'loan-9', amount: '999999999.00' },
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
        loanWizardStateRepository.compareAndSet.mockResolvedValue(true);

        const { LoanOverpaymentError } = await import('@afa/domain');
        logLoanPayment.execute.mockRejectedValue(
          new LoanOverpaymentError('loan-9', '999999999.00', '999999999.00', '920000.00'),
        );

        await runWithUserContext('user-abc-123', () =>
          callbackHandler({
            provisioning: provisioning(),
            callbackQuery: { data: 'loan_wizard_pay_confirm:5' },
            answerCbQuery,
            reply,
          }),
        );

        expect(reply).toHaveBeenCalledTimes(1);
      });
    });

    it('/cancel while a Loan Wizard is active clears the wizard instead of running the transaction-cancellation flow', async () => {
      const { loanWizardStateRepository, processConversationEvent } = buildService();
      loanWizardStateRepository.get.mockResolvedValue({
        version: 2,
        step: 'AWAITING_LENDER',
        createDraft: {},
        paymentDraft: null,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      loanWizardStateRepository.compareAndSet.mockResolvedValue(true);
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('cancel')!({ provisioning: provisioning(), reply }),
      );

      expect(loanWizardStateRepository.compareAndSet).toHaveBeenCalledWith('user-abc-123', 2, null);
      expect(processConversationEvent.execute).not.toHaveBeenCalled();
    });
  });

  describe('TASK-BOT-005 — Interruption Detector reply wiring (§5.6)', () => {
    it('an interruption_committed outcome sends the real confirmation for the NEW transaction plus the §5.6 note about the still-pending earlier entry', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'interruption_committed',
        candidate: {
          amount: 7000000,
          currency: 'UZS',
          category: 'SALARY',
          merchant: null,
          transactionDate: '2026-08-14',
        },
        transactionId: 'txn-new',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'maoshimdan 7 million oldim' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      const [text, options] = reply.mock.calls[0]!;
      expect(text).toContain('7,000,000 UZS');
      expect(text).toContain('still need details on your earlier entry');
      expect(options).toBeUndefined(); // no inline keyboard — this is always an auto_commit-band commit
    });

    it('§5.20.2 row 1/row 2 — read-only commands (/help) and /drafts never call RouteTextMessageUseCase or ProcessConversationEventUseCase, regardless of any pending state — structural bypass of the Transition Evaluator (§5.20.4), not a per-state check', async () => {
      const { routeTextMessage, processConversationEvent, listDrafts } = buildService();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('help')!({ provisioning: provisioning(), reply: vi.fn() }),
      );
      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('drafts')!({ provisioning: provisioning(), reply: vi.fn() }),
      );

      expect(routeTextMessage.execute).not.toHaveBeenCalled();
      expect(processConversationEvent.execute).not.toHaveBeenCalled();
      expect(listDrafts.execute).toHaveBeenCalledTimes(1); // /drafts itself is the only state-adjacent call, and it only reads
    });

    it('an interruption_commit_failed outcome sends a graceful failure message, not a thrown error', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'interruption_commit_failed',
        reason: 'category not found',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'maoshimdan 7 million oldim' },
        reply,
      };

      await expect(runWithUserContext('user-abc-123', () => handler(ctx))).resolves.not.toThrow();
      expect(reply).toHaveBeenCalledTimes(1);
    });
  });

  describe('TASK-BOT-002-FIX — Clarification Resolution Commit reply wiring (§5.2.3)', () => {
    it('a clarification_resolved outcome sends the real confirmation for the now-committed transaction, not a generic "Thanks, updating that now" acknowledgment', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'clarification_resolved',
        processEventOutcome: { status: 'transitioned', nextState: 'IDLE' },
        candidate: {
          amount: 45000,
          currency: 'UZS',
          category: 'FOOD_DINING',
          merchant: null,
          transactionDate: '2026-08-14',
        },
        transactionId: 'txn-resolved',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: '45000' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      const [text] = reply.mock.calls[0]!;
      expect(text).toContain('45,000 UZS');
      expect(text).not.toMatch(/thanks, updating/i);
    });

    it('a clarification_commit_failed outcome sends a graceful failure message, not a thrown error', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'clarification_commit_failed',
        reason: 'category not found',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: '45000' },
        reply,
      };

      await expect(runWithUserContext('user-abc-123', () => handler(ctx))).resolves.not.toThrow();
      expect(reply).toHaveBeenCalledTimes(1);
    });
  });

  describe('TASK-BOT-006 — Multi-Item Review Flow reply wiring (§5.7)', () => {
    function candidate(overrides: Record<string, unknown> = {}) {
      return {
        amount: 12000,
        currency: 'UZS',
        category: 'FOOD_DINING',
        merchant: null,
        transactionDate: '2026-08-14',
        description: 'Coffee',
        ...overrides,
      };
    }

    it('an all-high-confidence batch commit reports the real committed count, with no keyboard', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'batch_all_high_confidence_committed',
        totalItems: 2,
        committedCount: 2,
        failedCount: 0,
        transactionIds: ['txn-1', 'txn-2'],
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'lunch and coffee' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledTimes(1);
      const [text, options] = reply.mock.calls[0]!;
      expect(text).toContain('2 transactions');
      expect(options).toBeUndefined();
    });

    it('batch_review_started sends the summary FIRST (with the Import-confident-ones button), then the first low-confidence item card with Confirm/Skip/Cancel', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'batch_review_started',
        processEventOutcome: { status: 'transitioned', nextState: 'AWAITING_MULTI_ITEM_REVIEW' },
        batchId: 'batch-1',
        totalItems: 3,
        highConfidenceCount: 1,
        lowConfidenceCandidates: [candidate({ description: 'Coffee' })],
        lowConfidenceDraftIds: ['draft-low-1'],
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'lunch, coffee, and taxi' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledTimes(2);
      const [summaryText, summaryOptions] = reply.mock.calls[0]!;
      expect(summaryText).toContain('Found 3 transactions');
      expect(summaryText).toContain('1 high-confidence');
      expect(summaryOptions.reply_markup.inline_keyboard.flat()).toContainEqual(
        expect.objectContaining({ callback_data: 'batch_commit_high:batch-1' }),
      );

      const [itemText, itemOptions] = reply.mock.calls[1]!;
      expect(itemText).toContain('Item 1 of 1');
      expect(itemText).toContain('Coffee');
      expect(itemOptions.reply_markup.inline_keyboard.flat()).toContainEqual(
        expect.objectContaining({ callback_data: 'batch_confirm:draft-low-1' }),
      );
    });

    it('batch_review_started omits the Import-confident-ones button entirely when there are zero high-confidence items', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'batch_review_started',
        processEventOutcome: { status: 'transitioned', nextState: 'AWAITING_MULTI_ITEM_REVIEW' },
        batchId: 'batch-1',
        totalItems: 2,
        highConfidenceCount: 0,
        lowConfidenceCandidates: [candidate()],
        lowConfidenceDraftIds: ['draft-low-1'],
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'two vague things' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      const [, summaryOptions] = reply.mock.calls[0]!;
      expect(summaryOptions).toBeUndefined();
    });

    it('a batch_item_confirmed callback with a next item renders the next item card with a Confirm/Skip keyboard', async () => {
      const { routeCallbackQuery } = buildService();
      routeCallbackQuery.execute.mockResolvedValue({
        kind: 'batch_item_confirmed',
        processEventOutcome: { status: 'transitioned', nextState: 'AWAITING_MULTI_ITEM_REVIEW' },
        transactionId: 'txn-1',
        nextCandidate: candidate({ description: 'Taxi' }),
        nextPosition: 2,
        nextDraftId: 'draft-low-2',
        totalLowConfidence: 2,
      });

      const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const answerCbQuery = vi.fn();
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        callbackQuery: { data: 'batch_confirm:draft-low-1' },
        answerCbQuery,
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(answerCbQuery).toHaveBeenCalledTimes(1);
      const [text, options] = reply.mock.calls[0]!;
      expect(text).toContain('Item 2 of 2');
      expect(text).toContain('Taxi');
      expect(options.reply_markup.inline_keyboard.flat()).toContainEqual(
        expect.objectContaining({ callback_data: 'batch_confirm:draft-low-2' }),
      );
    });

    it('a batch_item_skipped callback with no next item announces review completion, not a stray item card', async () => {
      const { routeCallbackQuery } = buildService();
      routeCallbackQuery.execute.mockResolvedValue({
        kind: 'batch_item_skipped',
        processEventOutcome: { status: 'transitioned', nextState: 'IDLE' },
        nextCandidate: null,
        nextPosition: null,
        nextDraftId: null,
        totalLowConfidence: 2,
      });

      const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        callbackQuery: { data: 'batch_skip:draft-low-2' },
        answerCbQuery: vi.fn(),
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith(expect.stringMatching(/review complete/i));
    });

    it('a batch_commit_failed callback replies with the storage-failure message, not a thrown error', async () => {
      const { routeCallbackQuery } = buildService();
      routeCallbackQuery.execute.mockResolvedValue({
        kind: 'batch_commit_failed',
        reason: 'ledger unavailable',
      });

      const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        callbackQuery: { data: 'batch_confirm:draft-low-1' },
        answerCbQuery: vi.fn(),
        reply,
      };

      await expect(runWithUserContext('user-abc-123', () => handler(ctx))).resolves.not.toThrow();
      expect(reply).toHaveBeenCalledTimes(1);
    });

    it('a batch_high_confidence_committed callback reports the real committed count (FR-CE-031), state-independent', async () => {
      const { routeCallbackQuery } = buildService();
      routeCallbackQuery.execute.mockResolvedValue({
        kind: 'batch_high_confidence_committed',
        committedCount: 1,
        failedCount: 0,
        transactionIds: ['txn-1'],
      });

      const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        callbackQuery: { data: 'batch_commit_high:batch-1' },
        answerCbQuery: vi.fn(),
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('Logged 1 confident'));
    });

    describe('FR-CE-052 — batch cancellation requires two taps, not one', () => {
      it('a text "cancelled" outcome landing back on AWAITING_MULTI_ITEM_REVIEW (first tap) asks for confirmation, never claims "cancelled" prematurely', async () => {
        const { routeTextMessage } = buildService();
        routeTextMessage.execute.mockResolvedValue({
          kind: 'cancelled',
          processEventOutcome: { status: 'transitioned', nextState: 'AWAITING_MULTI_ITEM_REVIEW' },
        });

        const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const ctx = {
          provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
          message: { text: 'cancel' },
          reply,
        };

        await runWithUserContext('user-abc-123', () => handler(ctx));

        const [text] = reply.mock.calls[0]!;
        expect(text).not.toMatch(/^Okay, cancelled\.$/);
        expect(text).toMatch(/cancel the rest of this batch review/i);
      });

      it('a second cancellation landing on IDLE gets the normal CANCELLED_REPLY', async () => {
        const { routeTextMessage } = buildService();
        routeTextMessage.execute.mockResolvedValue({
          kind: 'cancelled',
          processEventOutcome: { status: 'transitioned', nextState: 'IDLE' },
        });

        const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const ctx = {
          provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
          message: { text: 'cancel' },
          reply,
        };

        await runWithUserContext('user-abc-123', () => handler(ctx));

        expect(reply).toHaveBeenCalledWith('Okay, cancelled.');
      });

      it('/cancel while AWAITING_MULTI_ITEM_REVIEW (first tap) also asks for confirmation, not a false "cancelled"', async () => {
        const { processConversationEvent } = buildService();
        processConversationEvent.execute.mockResolvedValue({
          status: 'transitioned',
          nextState: 'AWAITING_MULTI_ITEM_REVIEW',
        });
        const reply = vi.fn();

        await runWithUserContext('user-abc-123', () =>
          commandHandlers.get('cancel')!({ provisioning: provisioning(), reply }),
        );

        const [text] = reply.mock.calls[0]!;
        expect(text).toMatch(/cancel the rest of this batch review/i);
      });

      it('a cancelled callback-query outcome applies the same first-tap-vs-discard distinction', async () => {
        const { routeCallbackQuery } = buildService();
        routeCallbackQuery.execute.mockResolvedValue({
          kind: 'cancelled',
          processEventOutcome: { status: 'transitioned', nextState: 'AWAITING_MULTI_ITEM_REVIEW' },
        });

        const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
        const reply = vi.fn();
        const ctx = {
          provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
          callbackQuery: { data: 'cancel:draft-low-1' },
          answerCbQuery: vi.fn(),
          reply,
        };

        await runWithUserContext('user-abc-123', () => handler(ctx));

        expect(reply).toHaveBeenCalledWith(
          expect.stringMatching(/cancel the rest of this batch review/i),
        );
      });
    });
  });

  describe('TASK-BOT-008 — reply-language resolution wiring (Chapter 4 §4.2.2)', () => {
    it('a user with preferredLanguage="uz" gets the Uzbek /help message', async () => {
      buildService();
      const reply = vi.fn();

      await commandHandlers.get('help')!({
        provisioning: provisioning({ preferredLanguage: 'uz' }),
        reply,
      });

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('Mana men nima qila olaman'));
    });

    it('a user with preferredLanguage="ru" gets the Russian "nothing to cancel" message', async () => {
      const { processConversationEvent } = buildService();
      processConversationEvent.execute.mockResolvedValue({ status: 'rejected' });
      const reply = vi.fn();

      await runWithUserContext('user-abc-123', () =>
        commandHandlers.get('cancel')!({
          provisioning: provisioning({ preferredLanguage: 'ru' }),
          reply,
        }),
      );

      expect(reply).toHaveBeenCalledWith('Отменять нечего.');
    });

    it("preferredLanguage (ru) wins over this turn's detected language (uz) — Chapter 4 §4.2.2's override rule, end-to-end", async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'no_transaction_detected',
        detectedLanguage: 'uz',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: provisioning({ preferredLanguage: 'ru' }),
        message: { text: 'salom' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      // Russian (preferred), never Uzbek (detected) and never English.
      expect(reply).toHaveBeenCalledWith(expect.stringContaining('не нашёл'));
    });

    it("falls back to this turn's detected language (uz) when no preferredLanguage override applies", async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'no_transaction_detected',
        detectedLanguage: 'uz',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } }, // no preferredLanguage at all
        message: { text: 'salom' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('topa olmadim'));
    });

    it('falls back to English when neither preferredLanguage nor a detected language is available', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({ kind: 'extraction_unknown', reason: 'boom' });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: { user: { timezone: 'Asia/Tashkent', defaultCurrency: 'UZS' } },
        message: { text: 'xyz' },
        reply,
      };

      await runWithUserContext('user-abc-123', () => handler(ctx));

      expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't understand"));
    });

    it('an unrecognized preferredLanguage value (e.g. corrupted/unsupported, AI-P6 fail-closed) never leaks through as-is — falls back safely instead of throwing', async () => {
      const { routeTextMessage } = buildService();
      routeTextMessage.execute.mockResolvedValue({
        kind: 'no_transaction_detected',
        detectedLanguage: 'uz',
      });

      const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
      const reply = vi.fn();
      const ctx = {
        provisioning: provisioning({ preferredLanguage: 'fr' }), // not one of uz/ru/en
        message: { text: 'bonjour' },
        reply,
      };

      await expect(runWithUserContext('user-abc-123', () => handler(ctx))).resolves.not.toThrow();
      // Falls through to the detected language, never a thrown error and never a raw "fr" lookup.
      expect(reply).toHaveBeenCalledWith(expect.stringContaining('topa olmadim'));
    });

    it("the group-chat rejection message resolves language from Telegram's own language_code before any provisioning exists", async () => {
      const provisionTelegramUser = { execute: vi.fn() };
      new TelegramBotService(
        makeConfig(),
        provisionTelegramUser as any,
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
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const authMiddleware = useHandlers[AUTH_MIDDLEWARE_INDEX]!;
      const reply = vi.fn();
      const ctx = { chat: { type: 'group' }, from: { id: 42, language_code: 'ru' }, reply };

      await authMiddleware(ctx, async () => undefined);

      expect(reply).toHaveBeenCalledWith(expect.stringContaining('личном чате'));
      expect(provisionTelegramUser.execute).not.toHaveBeenCalled();
    });
  });
});

describe('TelegramBotService — /report (TASK-REP-TG)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  const dailyReportStub = {
    reportType: 'daily' as const,
    periodKey: '2026-08-30',
    totalExpense: '10.00',
    totalIncome: '0.00',
    categoryBreakdown: [],
    comparisonToDailyAverage: null,
  };

  function callbackCtx(data: string, reply: (...args: unknown[]) => unknown = vi.fn()) {
    return {
      provisioning: provisioning(),
      callbackQuery: { data },
      answerCbQuery: vi.fn(),
      reply,
    };
  }

  it('/report opens the report type menu with an inline keyboard (test #1)', async () => {
    buildService();
    const reply = vi.fn();

    await commandHandlers.get('report')!({ provisioning: provisioning(), reply });

    expect(reply).toHaveBeenCalledTimes(1);
    const [text, extra] = reply.mock.calls[0]!;
    expect(typeof text).toBe('string');
    expect(extra.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });

  it('the report menu includes a button for every one of the 11 real report types (test #2)', async () => {
    buildService();
    const reply = vi.fn();

    await commandHandlers.get('report')!({ provisioning: provisioning(), reply });

    const [, extra] = reply.mock.calls[0]!;
    const callbackDatas = extra.reply_markup.inline_keyboard
      .flat()
      .map((b: any) => b.callback_data);
    expect(REPORT_TYPES).toHaveLength(11);
    for (const type of REPORT_TYPES) {
      expect(callbackDatas).toContain(`report_type:${type}`);
    }
  });

  it('selecting "daily" calls GenerateReportUseCase.generateDaily with the authenticated user id (tests #3/#4)', async () => {
    const { generateReport } = buildService();
    generateReport.generateDaily.mockResolvedValue(dailyReportStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('report_type:daily')));

    expect(generateReport.generateDaily).toHaveBeenCalledWith('user-abc-123', expect.any(Date));
  });

  it("the same callback_data tapped by two different users resolves against each tapper's own user id, never a fixed/other id (test #5)", async () => {
    const { generateReport } = buildService();
    generateReport.generateDaily.mockResolvedValue(dailyReportStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    await runWithUserContext('user-a', () => handler(callbackCtx('report_type:daily')));
    await runWithUserContext('user-b', () => handler(callbackCtx('report_type:daily')));

    expect(generateReport.generateDaily).toHaveBeenNthCalledWith(1, 'user-a', expect.any(Date));
    expect(generateReport.generateDaily).toHaveBeenNthCalledWith(2, 'user-b', expect.any(Date));
  });

  it("a merchant callback hash derived from one user's own picker never resolves against another user's data (test #5, cross-user isolation)", async () => {
    const { generateReport, reportQueryRepository } = buildService();
    reportQueryRepository.getMerchantBreakdown.mockImplementation(async (userId: string) =>
      userId === 'user-a'
        ? [{ merchant: 'CoffeeShop', totalAmount: '5.00', transactionCount: 2 }]
        : [{ merchant: 'OtherStore', totalAmount: '9.00', transactionCount: 1 }],
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    let hashFromUserAsPicker = '';
    await runWithUserContext('user-a', () =>
      handler(
        callbackCtx('report_type:merchant', (_text: unknown, extra: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hashFromUserAsPicker = (extra as any).reply_markup.inline_keyboard[0][0].callback_data;
        }),
      ),
    );
    expect(hashFromUserAsPicker).toMatch(/^report_mer:/);

    const reply = vi.fn();
    await runWithUserContext('user-b', () => handler(callbackCtx(hashFromUserAsPicker, reply)));

    expect(generateReport.generateMerchantReport).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('an unrecognized report_type value is rejected as malformed, never passed through to the use case (test #6)', async () => {
    const { generateReport } = buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_type:not_a_real_type', reply)),
    );

    expect(generateReport.generateDaily).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('an unrecognized report_* callback altogether is also rejected as malformed (test #6)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_totally_unknown', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('report_cancel replies with the cancellation message (test #7)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('report_cancel', reply)));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
  });

  it('report_back re-shows the report type menu (test #7)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('report_back', reply)));

    const [, extra] = reply.mock.calls[0]!;
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data),
    ).toContain('report_type:daily');
  });

  it('an empty daily report gets the friendly "not enough data" reply, never a wall of zeros (test #8)', async () => {
    const { generateReport } = buildService();
    generateReport.generateDaily.mockResolvedValue({
      ...dailyReportStub,
      totalExpense: '0.00',
      totalIncome: '0.00',
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_type:daily', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('0.00');
    expect(text.length).toBeGreaterThan(0);
  });

  it('a GenerateReportUseCase failure never leaks internal error details to Telegram (test #9)', async () => {
    const { generateReport } = buildService();
    generateReport.generateDaily.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail, connection pool xyz'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_type:daily', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
    expect(text).not.toContain('connection pool');
  });

  it("a report whose rendered text exceeds Telegram's 4096-char limit is split into multiple safe-sized messages (test #10)", async () => {
    const { generateReport } = buildService();
    const longDescription = 'x'.repeat(500);
    const largestTransactions = Array.from({ length: 10 }, (_, i) => ({
      id: `txn-${i}`,
      amount: '12.34',
      transactionType: 'EXPENSE',
      categoryId: 'cat-1',
      merchant: null,
      transactionDate: new Date('2026-08-01'),
      description: `${longDescription}-${i}`,
    }));
    generateReport.generateCategoryReport.mockResolvedValue({
      reportType: 'category',
      categoryId: 'cat-1',
      range: { start: new Date('2026-07-01'), end: new Date('2026-08-01') },
      trend: [],
      merchantBreakdown: [],
      largestTransactions,
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('report_cat:cat-1', reply)));

    expect(reply.mock.calls.length).toBeGreaterThan(1);
    for (const call of reply.mock.calls) {
      expect((call[0] as string).length).toBeLessThanOrEqual(4096);
    }
  });

  it('the category picker is sourced from the real getCategoryBreakdown query, scoped to the authenticated user', async () => {
    const { reportQueryRepository } = buildService();
    reportQueryRepository.getCategoryBreakdown.mockResolvedValue([
      { categoryId: 'cat-1', totalAmount: '20.00' },
    ]);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_type:category', reply)),
    );

    expect(reportQueryRepository.getCategoryBreakdown).toHaveBeenCalledWith(
      'user-abc-123',
      expect.any(Object),
      expect.objectContaining({ transactionType: 'EXPENSE' }),
    );
    const [, extra] = reply.mock.calls[0]!;
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data),
    ).toContain('report_cat:cat-1');
  });

  it('a range-needing type (cash_flow) offers 7/30/90-day presets instead of generating immediately', async () => {
    const { generateReport } = buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_type:cash_flow', reply)),
    );

    expect(generateReport.generateCashFlow).not.toHaveBeenCalled();
    const [, extra] = reply.mock.calls[0]!;
    const callbackDatas = extra.reply_markup.inline_keyboard
      .flat()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.callback_data);
    expect(callbackDatas).toContain('report_range:cash_flow:7');
    expect(callbackDatas).toContain('report_range:cash_flow:30');
    expect(callbackDatas).toContain('report_range:cash_flow:90');
  });

  it('picking a preset range calls generateCashFlow with a start/end range and the report menu is reachable via Back', async () => {
    const { generateReport } = buildService();
    generateReport.generateCashFlow.mockResolvedValue({
      reportType: 'cash_flow',
      range: { start: new Date('2026-08-01'), end: new Date('2026-08-30') },
      totalExpense: '50.00',
      totalIncome: '0.00',
      periodicTrend: [],
      netCashFlow: '-50.00',
      fullCashFlow: null,
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('report_range:cash_flow:30', reply)),
    );

    expect(generateReport.generateCashFlow).toHaveBeenCalledWith(
      'user-abc-123',
      expect.objectContaining({ start: expect.any(Date), end: expect.any(Date) }),
      'UZS',
    );
    const [, extra] = reply.mock.calls[0]!;
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data),
    ).toContain('report_back');
  });
});

describe('TelegramBotService — /export (TASK-FIN-014)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  function callbackCtx(data: string, reply: (...args: unknown[]) => unknown = vi.fn()) {
    return {
      provisioning: provisioning(),
      callbackQuery: { data },
      answerCbQuery: vi.fn(),
      reply,
      replyWithDocument: vi.fn(),
    };
  }

  it('/export opens the export range menu with an inline keyboard (test #11)', async () => {
    buildService();
    const reply = vi.fn();

    await commandHandlers.get('export')!({ provisioning: provisioning(), reply });

    expect(reply).toHaveBeenCalledTimes(1);
    const [text, extra] = reply.mock.calls[0]!;
    expect(typeof text).toBe('string');
    expect(extra.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });

  it('the export menu includes a button for every real range preset (test #11)', async () => {
    buildService();
    const reply = vi.fn();

    await commandHandlers.get('export')!({ provisioning: provisioning(), reply });

    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callbackDatas = extra.reply_markup.inline_keyboard
      .flat()
      .map((b: any) => b.callback_data);
    for (const preset of EXPORT_RANGE_PRESETS) {
      expect(callbackDatas).toContain(`export_range:${preset}`);
    }
  });

  it('selecting a preset calls ExportTransactionsUseCase.execute with the authenticated user id and a computed range (test #12)', async () => {
    const { exportTransactions } = buildService();
    exportTransactions.execute.mockResolvedValue({ kind: 'empty' });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('export_range:this_month')));

    expect(exportTransactions.execute).toHaveBeenCalledWith(
      'user-abc-123',
      expect.objectContaining({ start: expect.any(Date), end: expect.any(Date) }),
    );
  });

  it("the same callback tapped by two different users resolves against each tapper's own user id (test #13, cross-user isolation)", async () => {
    const { exportTransactions } = buildService();
    exportTransactions.execute.mockResolvedValue({ kind: 'empty' });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    await runWithUserContext('user-a', () => handler(callbackCtx('export_range:this_month')));
    await runWithUserContext('user-b', () => handler(callbackCtx('export_range:this_month')));

    expect(exportTransactions.execute).toHaveBeenNthCalledWith(1, 'user-a', expect.any(Object));
    expect(exportTransactions.execute).toHaveBeenNthCalledWith(2, 'user-b', expect.any(Object));
  });

  it('an unrecognized export_range preset is rejected as malformed, never passed through to the use case', async () => {
    const { exportTransactions } = buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('export_range:not_a_real_preset', reply)),
    );

    expect(exportTransactions.execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('an unrecognized export_* callback altogether is rejected as malformed', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('export_totally_unknown', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('export_cancel replies with the cancellation message (cancel/back)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('export_cancel', reply)));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
  });

  it('an empty dataset gets the friendly "no transactions" reply, never an empty/broken file (test #2 telegram-level)', async () => {
    const { exportTransactions } = buildService();
    exportTransactions.execute.mockResolvedValue({ kind: 'empty' });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('export_range:all_time', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('No transactions found'));
  });

  it('a too-large dataset gets a friendly reply naming the real row count, never a truncated file', async () => {
    const { exportTransactions } = buildService();
    exportTransactions.execute.mockResolvedValue({ kind: 'too_large', rowCount: 7000 });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('export_range:all_time', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('7000'));
  });

  it('an ExportTransactionsUseCase failure never leaks internal error details to Telegram (test #10)', async () => {
    const { exportTransactions } = buildService();
    exportTransactions.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail, connection pool xyz'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('export_range:this_month', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('a generated export is sent as a Telegram document with a deterministic, safe .xlsx filename (test #14/#15)', async () => {
    const { exportTransactions } = buildService();
    const buffer = Buffer.from('fake-xlsx-bytes');
    exportTransactions.execute.mockResolvedValue({ kind: 'generated', buffer, rowCount: 3 });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const replyWithDocument = vi.fn();
    const ctx = { ...callbackCtx('export_range:this_month'), replyWithDocument };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(replyWithDocument).toHaveBeenCalledTimes(1);
    const [document] = replyWithDocument.mock.calls[0]!;
    expect(document.source).toBe(buffer);
    expect(document.filename).toMatch(/^transactions_export_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(document.filename).not.toContain('user-abc-123');
  });
});

describe('TelegramBotService — /settings (TASK-BOT-SET)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  function callbackCtx(data: string, reply: (...args: unknown[]) => unknown = vi.fn()) {
    return {
      provisioning: provisioning({
        status: 'active',
        deletionRequestedAt: null,
      }),
      callbackQuery: { data },
      answerCbQuery: vi.fn(),
      reply,
    };
  }

  const summaryStub = {
    user: {
      id: 'user-abc-123',
      preferredLanguage: 'en',
      defaultCurrency: 'UZS',
      timezone: 'Asia/Tashkent',
    },
    notificationPreferences: { debtReminder: true, budgetAlert: false },
    confidenceDisplay: true,
  };

  it('/settings opens the menu and shows the current profile values (happy path, view)', async () => {
    const { getUserSettingsSummary } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('settings')!({ provisioning: provisioning(), reply }),
    );

    expect(reply).toHaveBeenCalledTimes(1);
    const [text, extra] = reply.mock.calls[0]!;
    expect(text).toContain('UZS');
    expect(text).toContain('Asia/Tashkent');
    expect(extra.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });

  it('the menu includes every implemented settings category plus Cancel', async () => {
    const { getUserSettingsSummary } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('settings')!({ provisioning: provisioning(), reply }),
    );

    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues).toEqual(
      expect.arrayContaining([
        'settings_lang',
        'settings_currency',
        'settings_timezone',
        'settings_notif',
        'settings_confidence',
        'settings_export',
        'settings_deleteaccount',
        'settings_cancel',
      ]),
    );
  });

  it('settings_lang shows the language picker', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('settings_lang', reply)));

    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues).toContain('settings_lang_set:ru');
  });

  it('settings_lang_set:ru calls UpdateUserProfileUseCase with the authenticated user id and confirms the change (happy path)', async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockResolvedValue({
      kind: 'updated',
      user: { ...summaryStub.user, preferredLanguage: 'ru' },
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_lang_set:ru', reply)),
    );

    expect(updateUserProfile.execute).toHaveBeenCalledWith('user-abc-123', 'language', 'ru');
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('set to'),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it('an invalid language value from UpdateUserProfileUseCase gets a friendly "not supported" reply (invalid input)', async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockResolvedValue({ kind: 'invalid_value' });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_lang_set:de', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it("the same callback tapped by two different users resolves against each tapper's own user id (cross-user isolation)", async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockResolvedValue({ kind: 'updated', user: summaryStub.user });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    await runWithUserContext('user-a', () => handler(callbackCtx('settings_lang_set:uz')));
    await runWithUserContext('user-b', () => handler(callbackCtx('settings_lang_set:uz')));

    expect(updateUserProfile.execute).toHaveBeenNthCalledWith(1, 'user-a', 'language', 'uz');
    expect(updateUserProfile.execute).toHaveBeenNthCalledWith(2, 'user-b', 'language', 'uz');
  });

  it('an unrecognized settings_* callback is rejected as malformed, never passed through to any use case', async () => {
    const { updateUserProfile, setUserPreference } = buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_totally_unknown', reply)),
    );

    expect(updateUserProfile.execute).not.toHaveBeenCalled();
    expect(setUserPreference.execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('an unrecognized notification toggle key is rejected as malformed (invalid callback)', async () => {
    const { setUserPreference } = buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_notif_toggle:not_a_real_toggle', reply)),
    );

    expect(setUserPreference.execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });

  it('settings_cancel replies with the cancellation message (cancel/back)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('settings_cancel', reply)));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
  });

  it('settings_back re-shows the settings menu (cancel/back)', async () => {
    const { getUserSettingsSummary } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('settings_back', reply)));

    const [, extra] = reply.mock.calls[0]!;
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data),
    ).toContain('settings_lang');
  });

  it('settings_currency shows the currency picker built from the real CurrencyRepository.listActiveCodes()', async () => {
    const { currencyRepository } = buildService();
    currencyRepository.listActiveCodes.mockResolvedValue(['UZS', 'USD']);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_currency', reply)),
    );

    expect(currencyRepository.listActiveCodes).toHaveBeenCalled();
    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues).toContain('settings_currency_set:USD');
  });

  it('settings_currency_set:USD updates the currency (happy path) and persists via UpdateUserProfileUseCase', async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockResolvedValue({
      kind: 'updated',
      user: { ...summaryStub.user, defaultCurrency: 'USD' },
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_currency_set:USD', reply)),
    );

    expect(updateUserProfile.execute).toHaveBeenCalledWith('user-abc-123', 'currency', 'USD');
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('USD'), expect.any(Object));
  });

  it('settings_timezone shows the curated timezone picker', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_timezone', reply)),
    );

    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues).toContain('settings_timezone_set:Asia/Tashkent');
  });

  it('settings_timezone_set:Europe/London updates the timezone (happy path)', async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockResolvedValue({
      kind: 'updated',
      user: { ...summaryStub.user, timezone: 'Europe/London' },
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_timezone_set:Europe/London', reply)),
    );

    expect(updateUserProfile.execute).toHaveBeenCalledWith(
      'user-abc-123',
      'timezone',
      'Europe/London',
    );
  });

  it('an invalid timezone value from UpdateUserProfileUseCase gets a friendly "not supported" reply (invalid input)', async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockResolvedValue({ kind: 'invalid_value' });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_timezone_set:Not/A_Real_Zone', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it('settings_notif shows the notifications submenu reflecting the real current state (read-after-write consistency)', async () => {
    const { getUserSettingsSummary } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('settings_notif', reply)));

    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debtButton = extra.reply_markup.inline_keyboard[0][0] as any;
    expect(debtButton.text).toContain('✅');
  });

  it('settings_notif_toggle:debt_reminder flips the current value and persists via SetUserPreferenceUseCase (happy path, persistence)', async () => {
    const { getUserSettingsSummary, setUserPreference } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_notif_toggle:debt_reminder', reply)),
    );

    // summaryStub.debtReminder is true, so toggling must persist false.
    expect(setUserPreference.execute).toHaveBeenCalledWith(
      'user-abc-123',
      'notif_debt_reminder',
      false,
    );
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('disabled'), expect.any(Object));
  });

  it('settings_notif_toggle:budget_alert flips the current value in the other direction', async () => {
    const { getUserSettingsSummary, setUserPreference } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_notif_toggle:budget_alert', reply)),
    );

    // summaryStub.budgetAlert is false, so toggling must persist true.
    expect(setUserPreference.execute).toHaveBeenCalledWith(
      'user-abc-123',
      'notif_budget_alert',
      true,
    );
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('enabled'), expect.any(Object));
  });

  it('settings_confidence shows the confidence-display toggle reflecting current state', async () => {
    const { getUserSettingsSummary } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_confidence', reply)),
    );

    const [, extra] = reply.mock.calls[0]!;
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data),
    ).toContain('settings_confidence_toggle');
  });

  it('settings_confidence_toggle flips and persists the confidence-display preference (happy path, persistence)', async () => {
    const { getUserSettingsSummary, setUserPreference } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_confidence_toggle', reply)),
    );

    // summaryStub.confidenceDisplay is true, so toggling must persist false.
    expect(setUserPreference.execute).toHaveBeenCalledWith(
      'user-abc-123',
      'confidence_display',
      false,
    );
  });

  it('settings_export redirects to the exact same export menu /export itself shows (reuse, not duplication)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () => handler(callbackCtx('settings_export', reply)));

    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues.some((d: string) => d.startsWith('export_range:'))).toBe(true);
  });

  it('settings_deleteaccount redirects to the exact same delete-account prompt /deleteaccount itself shows (reuse, not duplication)', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = callbackCtx('settings_deleteaccount', reply);

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(reply).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
  });

  it('settings_deleteaccount shows the already-pending status when the user is already pending_deletion', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = {
      provisioning: provisioning({
        status: 'pending_deletion',
        deletionRequestedAt: new Date(),
      }),
      callbackQuery: { data: 'settings_deleteaccount' },
      answerCbQuery: vi.fn(),
      reply,
    };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('already'), expect.any(Object));
  });

  it('a GetUserSettingsSummaryUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { getUserSettingsSummary } = buildService();
    getUserSettingsSummary.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('settings')!({ provisioning: provisioning(), reply }),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('an UpdateUserProfileUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { updateUserProfile } = buildService();
    updateUserProfile.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_lang_set:ru', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('a SetUserPreferenceUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { getUserSettingsSummary, setUserPreference } = buildService();
    getUserSettingsSummary.execute.mockResolvedValue(summaryStub);
    setUserPreference.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_notif_toggle:debt_reminder', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });
});

describe('TelegramBotService — /undo (TASK-FIN-013)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  function fixtureTransaction(overrides: Record<string, unknown> = {}) {
    return {
      id: 'txn-1',
      amount: '45000',
      currency: 'UZS',
      categoryId: 'FOOD_DINING',
      merchant: 'Taxi',
      transactionDate: new Date('2026-01-15'),
      ...overrides,
    };
  }

  it('/undo command works — calls UndoLastTransactionActionUseCase and replies (happy path)', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({
      kind: 'undone',
      action: 'deleted',
      transaction: fixtureTransaction(),
    });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    expect(undoLastTransactionAction.execute).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('passes the authenticated user id straight through to the use case, never anything from the update payload', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({ kind: 'nothing_to_undo' });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    expect(undoLastTransactionAction.execute).toHaveBeenCalledWith('user-abc-123');
  });

  it('cross-user isolation: two different authenticated users each resolve against their own user id', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({ kind: 'nothing_to_undo' });
    const reply = vi.fn();

    await runWithUserContext('user-a', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );
    await runWithUserContext('user-b', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    expect(undoLastTransactionAction.execute).toHaveBeenNthCalledWith(1, 'user-a');
    expect(undoLastTransactionAction.execute).toHaveBeenNthCalledWith(2, 'user-b');
  });

  it('nothing_to_undo gets a friendly, non-technical reply', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({ kind: 'nothing_to_undo' });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text.toLowerCase()).toContain('nothing to undo');
  });

  it('unsupported_action (last action was an edit) discloses the real limitation rather than inventing a revert', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({ kind: 'unsupported_action' });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).toContain("Couldn't undo");
  });

  it('undone/deleted (last action was a delete, reversed via restore) replies with a "Restored" confirmation carrying the real transaction data', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({
      kind: 'undone',
      action: 'deleted',
      transaction: fixtureTransaction({ amount: '45000', currency: 'UZS', merchant: 'Taxi' }),
    });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).toContain('Restored');
    expect(text).toContain('45000 UZS');
    expect(text).toContain('Taxi');
  });

  it('undone/created (last action was a create never since edited, reversed via delete) replies with a "Removed" confirmation', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockResolvedValue({
      kind: 'undone',
      action: 'created',
      transaction: fixtureTransaction({ amount: '9000', currency: 'UZS', merchant: null }),
    });
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).toContain('Removed');
    expect(text).toContain('9000 UZS');
  });

  it('a UndoLastTransactionActionUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { undoLastTransactionAction } = buildService();
    undoLastTransactionAction.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      commandHandlers.get('undo')!({ provisioning: provisioning(), reply }),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('/undo is registered as a real command handler distinct from every other command (command-registry / existing-command regression)', () => {
    buildService();

    expect(commandHandlers.has('undo')).toBe(true);
    expect(commandHandlers.has('settings')).toBe(true);
    expect(commandHandlers.has('export')).toBe(true);
    expect(commandHandlers.has('report')).toBe(true);
  });
});

describe('TelegramBotService — /settings Custom Categories (TASK-FIN-006)', () => {
  beforeEach(() => {
    useHandlers.length = 0;
    onHandlers.length = 0;
    commandHandlers.clear();
    catchHandlers.length = 0;
    vi.clearAllMocks();
  });

  function callbackCtx(data: string, reply: (...args: unknown[]) => unknown = vi.fn()) {
    return {
      provisioning: provisioning(),
      callbackQuery: { data },
      answerCbQuery: vi.fn(),
      reply,
    };
  }

  function fixtureCustomCategory(overrides: Record<string, unknown> = {}) {
    return {
      id: 'custom-1',
      ownerUserId: 'user-abc-123',
      name: "Kids' Football Club",
      parentCategoryId: 'sys-education',
      defaultType: 'expense',
      status: 'active',
      replacementCategoryId: null,
      createdAt: new Date('2026-01-01'),
      isDeleted: false,
      ...overrides,
    };
  }

  const parentOption = {
    id: 'sys-education',
    code: 'EDUCATION',
    label: 'Education',
    defaultType: 'expense',
    icon: null,
  };

  it('settings_categories lists the real, current-user-scoped custom categories', async () => {
    const { listCustomCategories } = buildService();
    listCustomCategories.execute.mockResolvedValue([fixtureCustomCategory()]);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories', reply)),
    );

    expect(listCustomCategories.execute).toHaveBeenCalledWith('user-abc-123');
    const [, extra] = reply.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues).toContain('settings_categories_delete:custom-1');
    expect(dataValues).toContain('settings_categories_add');
  });

  it('a user with no custom categories gets a friendly empty-list message, not a bare menu', async () => {
    const { listCustomCategories } = buildService();
    listCustomCategories.execute.mockResolvedValue([]);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text.toLowerCase()).toMatch(/don't have any custom categories/);
  });

  it('settings_categories_add starts the wizard: sets AWAITING_NAME state and prompts for a name', async () => {
    const { customCategoryWizardStateRepository } = buildService();
    customCategoryWizardStateRepository.get.mockResolvedValue(null);
    customCategoryWizardStateRepository.compareAndSet.mockResolvedValue(true);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_add', reply)),
    );

    expect(customCategoryWizardStateRepository.compareAndSet).toHaveBeenCalledWith(
      'user-abc-123',
      0,
      expect.objectContaining({ step: 'AWAITING_NAME', name: null }),
    );
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('name'));
  });

  it('the name step: a valid, non-duplicate name advances to AWAITING_PARENT_SELECTION and shows the parent picker', async () => {
    const { customCategoryWizardStateRepository, createCustomCategory } = buildService();
    createCustomCategory.checkNameAvailability.mockResolvedValue('available');
    createCustomCategory.listParentOptions.mockResolvedValue([parentOption]);
    customCategoryWizardStateRepository.compareAndSet.mockResolvedValue(true);
    customCategoryWizardStateRepository.get.mockResolvedValue({
      version: 1,
      step: 'AWAITING_NAME',
      name: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = {
      provisioning: provisioning(),
      message: { text: "Kids' Football Club" },
      reply,
    };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(createCustomCategory.checkNameAvailability).toHaveBeenCalledWith(
      'user-abc-123',
      "Kids' Football Club",
    );
    expect(customCategoryWizardStateRepository.compareAndSet).toHaveBeenCalledWith(
      'user-abc-123',
      1,
      expect.objectContaining({ step: 'AWAITING_PARENT_SELECTION', name: "Kids' Football Club" }),
    );
    const [, extra] = reply.mock.calls.at(-1)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataValues = extra.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(dataValues).toContain('settings_categories_parent:EDUCATION');
  });

  it('a duplicate name at the name step is rejected with a friendly reply, never advances the wizard', async () => {
    const { customCategoryWizardStateRepository, createCustomCategory } = buildService();
    createCustomCategory.checkNameAvailability.mockResolvedValue('duplicate');
    customCategoryWizardStateRepository.get.mockResolvedValue({
      version: 1,
      step: 'AWAITING_NAME',
      name: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const handler = onHandlers[TEXT_HANDLER_INDEX]!.handler;
    const reply = vi.fn();
    const ctx = { provisioning: provisioning(), message: { text: 'Food' }, reply };

    await runWithUserContext('user-abc-123', () => handler(ctx));

    expect(customCategoryWizardStateRepository.compareAndSet).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('settings_categories_parent:<code> creates the real category and confirms with the resolved parent label (happy path)', async () => {
    const { customCategoryWizardStateRepository, createCustomCategory } = buildService();
    customCategoryWizardStateRepository.get.mockResolvedValue({
      version: 2,
      step: 'AWAITING_PARENT_SELECTION',
      name: "Kids' Football Club",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    createCustomCategory.execute.mockResolvedValue({
      kind: 'created',
      category: fixtureCustomCategory(),
      parentLabel: 'Education',
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_parent:EDUCATION', reply)),
    );

    expect(createCustomCategory.execute).toHaveBeenCalledWith({
      userId: 'user-abc-123',
      name: "Kids' Football Club",
      language: 'en',
      parentCategoryCode: 'EDUCATION',
    });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Education'));
  });

  it('an invalid/forged parent code gets a generic safe reply, never a raw parent id trusted', async () => {
    const { customCategoryWizardStateRepository, createCustomCategory } = buildService();
    customCategoryWizardStateRepository.get.mockResolvedValue({
      version: 2,
      step: 'AWAITING_PARENT_SELECTION',
      name: 'Side Hustle',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    createCustomCategory.execute.mockResolvedValue({ kind: 'invalid_parent' });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_parent:NOT_REAL', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Invalid'));
  });

  it('a stale/forged settings_categories_parent callback (no active wizard) gets a generic safe reply, never an internal error', async () => {
    const { customCategoryWizardStateRepository, createCustomCategory } = buildService();
    customCategoryWizardStateRepository.get.mockResolvedValue(null);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_parent:EDUCATION', reply)),
    );

    expect(createCustomCategory.execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('settings_categories_delete:<id> shows the real preview (affected count + parent label) before anything is deleted', async () => {
    const { deleteCustomCategory } = buildService();
    deleteCustomCategory.preview.mockResolvedValue({
      category: fixtureCustomCategory(),
      parentLabel: 'Education',
      affectedTransactionCount: 3,
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_delete:custom-1', reply)),
    );

    expect(deleteCustomCategory.preview).toHaveBeenCalledWith('custom-1', 'user-abc-123', 'en');
    expect(deleteCustomCategory.execute).not.toHaveBeenCalled();
    const [text] = reply.mock.calls[0]!;
    expect(text).toContain('3');
    expect(text).toContain('Education');
  });

  it('another user\'s category id (or a forged one) at preview gets a generic safe "not found" reply — cross-user isolation', async () => {
    const { CustomCategoryNotFoundError } = await import('@afa/application');
    const { deleteCustomCategory } = buildService();
    deleteCustomCategory.preview.mockRejectedValue(new CustomCategoryNotFoundError('custom-1'));
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-b', () =>
      handler(callbackCtx('settings_categories_delete:custom-1', reply)),
    );

    expect(deleteCustomCategory.preview).toHaveBeenCalledWith('custom-1', 'user-b', 'en');
    const [text] = reply.mock.calls[0]!;
    expect(text.toLowerCase()).toContain('not found');
  });

  it('settings_categories_delete_confirm:<id> executes the real delete+re-tag and reports the real result', async () => {
    const { deleteCustomCategory } = buildService();
    deleteCustomCategory.execute.mockResolvedValue({
      category: fixtureCustomCategory({ status: 'deprecated' }),
      parentLabel: 'Education',
      reassignedTransactionCount: 3,
    });
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_delete_confirm:custom-1', reply)),
    );

    expect(deleteCustomCategory.execute).toHaveBeenCalledWith('custom-1', 'user-abc-123', 'en');
    const [text] = reply.mock.calls[0]!;
    expect(text).toContain('3');
    expect(text).toContain('Education');
  });

  it('a second confirm of an already-deprecated category (idempotent double-delete) gets a safe reply, never a second reversal', async () => {
    const { deleteCustomCategory } = buildService();
    deleteCustomCategory.execute.mockResolvedValue(null);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_delete_confirm:custom-1', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text.toLowerCase()).toContain('not found');
  });

  it('settings_categories_cancel clears the wizard state and returns to the categories list', async () => {
    const { customCategoryWizardStateRepository, listCustomCategories } = buildService();
    customCategoryWizardStateRepository.get.mockResolvedValue({
      version: 1,
      step: 'AWAITING_NAME',
      name: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    listCustomCategories.execute.mockResolvedValue([]);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_cancel', reply)),
    );

    expect(customCategoryWizardStateRepository.compareAndSet).toHaveBeenCalledWith(
      'user-abc-123',
      1,
      null,
    );
    expect(listCustomCategories.execute).toHaveBeenCalled();
  });

  it('cross-user isolation: two different users each act against their own userId only', async () => {
    const { listCustomCategories } = buildService();
    listCustomCategories.execute.mockResolvedValue([]);
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;

    await runWithUserContext('user-a', () => handler(callbackCtx('settings_categories')));
    await runWithUserContext('user-b', () => handler(callbackCtx('settings_categories')));

    expect(listCustomCategories.execute).toHaveBeenNthCalledWith(1, 'user-a');
    expect(listCustomCategories.execute).toHaveBeenNthCalledWith(2, 'user-b');
  });

  it('a ListCustomCategoriesUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { listCustomCategories } = buildService();
    listCustomCategories.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('a CreateCustomCategoryUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { customCategoryWizardStateRepository, createCustomCategory } = buildService();
    customCategoryWizardStateRepository.get.mockResolvedValue({
      version: 2,
      step: 'AWAITING_PARENT_SELECTION',
      name: 'Side Hustle',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    createCustomCategory.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_parent:EDUCATION', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('a DeleteCustomCategoryUseCase failure never leaks internal error details to Telegram (error handling)', async () => {
    const { deleteCustomCategory } = buildService();
    deleteCustomCategory.execute.mockRejectedValue(
      new Error('P2028: transaction timeout — prisma internal detail'),
    );
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_delete_confirm:custom-1', reply)),
    );

    const [text] = reply.mock.calls[0]!;
    expect(text).not.toContain('P2028');
    expect(text).not.toContain('prisma');
  });

  it('an unrecognized settings_categories_* callback is rejected as malformed', async () => {
    buildService();
    const handler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const reply = vi.fn();

    await runWithUserContext('user-abc-123', () =>
      handler(callbackCtx('settings_categories_not_a_real_action', reply)),
    );

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("couldn't process"));
  });
});

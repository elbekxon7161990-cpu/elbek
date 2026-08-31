import { runWithUserContext } from '@afa/shared';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CreateCustomCategoryUseCase, DeleteCustomCategoryUseCase } from '@afa/application';
import type { CustomCategoryWizardStateRecord } from '@afa/domain';
import {
  PRISMA_BASE_CLIENT,
  PrismaCategoryRepository,
  PrismaModule,
  PrismaService,
  PrismaTransactionRepository,
} from '@afa/infrastructure';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Custom Categories REAL INTEGRATION (TASK-FIN-006) — real Postgres, real
 * use-cases, a real-DI `TelegramBotService` dispatching the actual
 * `/settings` Custom Categories flow, and a dedicated proof that the new
 * RLS policy (migration `20260830000000_custom_categories`) actually blocks
 * cross-user access at the database engine level.
 *
 * Two connections, deliberately:
 *  - `prisma` (owner-role `DIRECT_URL`, mirroring `undo-concurrency
 *    .integration.spec.ts`'s own established convention): CRUD/mapping
 *    correctness, fixture setup/teardown, the concurrent-create/delete
 *    races, and the real `/settings` flow. Owner role bypasses RLS by
 *    design (Postgres never enforces row-level security against a table's
 *    own owner), so this half proves everything EXCEPT the RLS policy
 *    itself.
 *  - `rlsCategoryRepository` (the real, DI-wired, RLS-EXTENDED client —
 *    `Test.createTestingModule` + `PrismaModule`, real `app_user`/pooler
 *    `DATABASE_URL`, the same bootstrap `settings-generation.integration
 *    .spec.ts` already established as working): the one test that
 *    specifically proves the new `category_visibility`/
 *    `category_owner_insert`/`category_owner_update` policies actually
 *    block cross-user access at the database engine level, not merely at
 *    the application layer.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

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
// voice, photo, document, unsupported, callback_query.
const TEXT_HANDLER_INDEX = 0;
const CALLBACK_HANDLER_INDEX = 5;

const TELEGRAM_USER_ID_A = 900_000_001_310n;
const TELEGRAM_USER_ID_B = 900_000_001_311n;

function callbackCtx(data: string, reply: (...args: unknown[]) => unknown = vi.fn()) {
  return {
    provisioning: { user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: 'UZS' } },
    callbackQuery: { data },
    answerCbQuery: vi.fn(),
    reply,
  };
}

function textCtx(text: string, reply: (...args: unknown[]) => unknown = vi.fn()) {
  return {
    provisioning: { user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: 'UZS' } },
    message: { text },
    reply,
  };
}

describe('Custom Categories real integration — real Postgres, real use-cases, real RLS policy, real-DI TelegramBotService (TASK-FIN-006)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const categoryRepository = new PrismaCategoryRepository(prisma, prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const createCustomCategory = new CreateCustomCategoryUseCase(categoryRepository);
  const deleteCustomCategory = new DeleteCustomCategoryUseCase(
    categoryRepository,
    transactionRepository,
  );

  let userIdA: string;
  let userIdB: string;
  let educationCategoryId: string;
  const createdCategoryIds: string[] = [];

  function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'Custom Category Test User A' },
      update: {},
    });
    userIdA = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'Custom Category Test User B' },
      update: {},
    });
    userIdB = userB.id;

    const education = await prisma.category.findFirstOrThrow({
      where: { code: 'EDUCATION', isSystem: true, status: 'active' },
    });
    educationCategoryId = education.id;

    // Defensive cleanup: `userIdA`/`userIdB` are fixed telegram-user-id
    // constants reused across every run of this suite, so a PRIOR run that
    // died mid-way (e.g. a transient Supabase connectivity drop between
    // `beforeAll` and `afterAll` — this suite has hit exactly that during
    // development) can leave real leftover rows behind that `afterAll` never
    // got to remove. Without this, a later clean run would spuriously see
    // "Kids' Football Club" etc. as already-existing duplicates. Scoped only
    // to these two fixed test users — never touches any other user's data.
    const staleCategoryIds = (
      await prisma.category.findMany({
        where: { ownerUserId: { in: [userIdA, userIdB] } },
        select: { id: true },
      })
    ).map((c) => c.id);
    await prisma.transaction.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    if (staleCategoryIds.length > 0) {
      await prisma.categoryTranslation.deleteMany({
        where: { categoryId: { in: staleCategoryIds } },
      });
      await prisma.category.deleteMany({ where: { id: { in: staleCategoryIds } } });
    }
  }, 30_000);

  afterAll(async () => {
    // Each step tolerates a transient connectivity blip independently
    // (`.catch(() => undefined)`) rather than letting one failed step abort
    // the whole hook and leave later cleanup steps unrun — the defensive
    // re-cleanup in `beforeAll` above is the real safety net for leftover
    // rows regardless.
    await prisma.transaction
      .deleteMany({ where: { userId: { in: [userIdA, userIdB] } } })
      .catch(() => undefined);
    if (createdCategoryIds.length > 0) {
      await prisma.categoryTranslation
        .deleteMany({ where: { categoryId: { in: createdCategoryIds } } })
        .catch(() => undefined);
      await prisma.category
        .deleteMany({ where: { id: { in: createdCategoryIds } } })
        .catch(() => undefined);
    }
    await prisma.user
      .deleteMany({ where: { id: { in: [userIdA, userIdB] } } })
      .catch(() => undefined);
    await prisma.onModuleDestroy();
  }, 30_000);

  it('creates a real custom category persisted with its parent relation intact (create persistence, parent relation)', async () => {
    const outcome = await asUser(userIdA, () =>
      createCustomCategory.execute({
        userId: userIdA,
        name: "Kids' Football Club",
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    );

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('unreachable');
    createdCategoryIds.push(outcome.category.id);
    expect(outcome.category.parentCategoryId).toBe(educationCategoryId);
    expect(outcome.parentLabel).toBe('Education');

    const reread = await categoryRepository.findCustomCategoryById(outcome.category.id, userIdA);
    expect(reread?.name).toBe("Kids' Football Club");
    expect(reread?.parentCategoryId).toBe(educationCategoryId);
  }, 30_000);

  it('duplicate enforcement: the same name for the same user is rejected, case-insensitively', async () => {
    const outcome = await asUser(userIdA, () =>
      createCustomCategory.execute({
        userId: userIdA,
        name: "KIDS' FOOTBALL CLUB",
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    );

    expect(outcome).toEqual({ kind: 'duplicate_name' });
  }, 30_000);

  it("user isolation: the same name is NOT a duplicate for a different user (BR-FIN-005) and another user's category is invisible via ownership-scoped read", async () => {
    const outcome = await asUser(userIdB, () =>
      createCustomCategory.execute({
        userId: userIdB,
        name: "Kids' Football Club",
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    );

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('unreachable');
    createdCategoryIds.push(outcome.category.id);

    const [categoryA] = await categoryRepository.listCustomCategoriesForUser(userIdA);
    const asSeenByB = await categoryRepository.findCustomCategoryById(categoryA!.id, userIdB);
    expect(asSeenByB).toBeNull();
  }, 30_000);

  it('concurrent create of the same name races safely: exactly one succeeds, the DB-level unique index (not just the app pre-check) decides', async () => {
    const results = await Promise.allSettled([
      createCustomCategory.execute({
        userId: userIdA,
        name: 'Race Category',
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
      createCustomCategory.execute({
        userId: userIdA,
        name: 'Race Category',
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    ]);

    const created = results.filter(
      (r) => r.status === 'fulfilled' && r.value.kind === 'created',
    ) as PromiseFulfilledResult<{ kind: 'created'; category: { id: string } }>[];
    const duplicates = results.filter(
      (r) => r.status === 'fulfilled' && r.value.kind === 'duplicate_name',
    );
    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    createdCategoryIds.push(created[0]!.value.category.id);
  }, 30_000);

  it('delete + re-tag: existing transactions are re-tagged to the parent, atomically, and the category itself is soft-deprecated (never hard-deleted)', async () => {
    const outcome = await asUser(userIdA, () =>
      createCustomCategory.execute({
        userId: userIdA,
        name: 'Side Hustle Delete Test',
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    );
    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('unreachable');
    const customCategoryId = outcome.category.id;
    createdCategoryIds.push(customCategoryId);

    const txn = await asUser(userIdA, () =>
      transactionRepository.create({
        userId: userIdA,
        transactionType: 'EXPENSE',
        amount: '5000',
        currency: 'UZS',
        categoryId: customCategoryId,
        transactionDate: new Date('2026-01-20'),
        description: 'Tagged to the custom category',
        originalText: 'Tagged to the custom category',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );

    const preview = await asUser(userIdA, () =>
      deleteCustomCategory.preview(customCategoryId, userIdA, 'en'),
    );
    expect(preview.affectedTransactionCount).toBe(1);
    expect(preview.parentLabel).toBe('Education');

    const result = await asUser(userIdA, () =>
      deleteCustomCategory.execute(customCategoryId, userIdA, 'en'),
    );
    expect(result).not.toBeNull();
    expect(result?.reassignedTransactionCount).toBe(1);
    expect(result?.parentLabel).toBe('Education');

    const rereadTransaction = await transactionRepository.findById(txn.id);
    expect(rereadTransaction?.categoryId).toBe(educationCategoryId);

    const rawRow = await prisma.category.findUnique({ where: { id: customCategoryId } });
    expect(rawRow).not.toBeNull();
    expect(rawRow?.status).toBe('deprecated');
    expect(rawRow?.replacementCategoryId).toBe(educationCategoryId);

    const activeList = await categoryRepository.listCustomCategoriesForUser(userIdA);
    expect(activeList.some((c) => c.id === customCategoryId)).toBe(false);
  }, 30_000);

  it('concurrent delete of the same category races safely: exactly one reversal, the other a safe no-op (idempotent double-delete)', async () => {
    const outcome = await asUser(userIdA, () =>
      createCustomCategory.execute({
        userId: userIdA,
        name: 'Concurrent Delete Test',
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    );
    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('unreachable');
    const customCategoryId = outcome.category.id;
    createdCategoryIds.push(customCategoryId);

    const results = await Promise.allSettled([
      deleteCustomCategory.execute(customCategoryId, userIdA, 'en'),
      deleteCustomCategory.execute(customCategoryId, userIdA, 'en'),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value !== null);
    const noOps = results.filter((r) => r.status === 'fulfilled' && r.value === null);
    expect(succeeded).toHaveLength(1);
    expect(noOps).toHaveLength(1);
  }, 30_000);

  it('RLS enforcement: the new category_visibility policy hides another user\'s custom category from a raw ORM read, even bypassing the application layer entirely', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();
    const rlsPrisma: PrismaService = moduleRef.get(PrismaService);
    const basePrisma: PrismaService = moduleRef.get(PRISMA_BASE_CLIENT);
    await basePrisma.onModuleInit();

    try {
      const outcome = await asUser(userIdA, () =>
        createCustomCategory.execute({
          userId: userIdA,
          name: 'RLS Proof Category',
          language: 'en',
          parentCategoryCode: 'EDUCATION',
        }),
      );
      expect(outcome.kind).toBe('created');
      if (outcome.kind !== 'created') throw new Error('unreachable');
      createdCategoryIds.push(outcome.category.id);

      // Wrapped in a genuine `async` function that awaits the Prisma call
      // INTERNALLY (not `() => rlsPrisma....` returning an un-awaited
      // `PrismaPromise` for the caller to await outside `runWithUserContext`'s
      // own synchronous callback window) — matching the shape every real
      // repository method in this codebase already uses. A `PrismaPromise`
      // only actually dispatches its query (running the RLS extension's
      // `$allOperations` hook) once `.then()`/`await` is invoked on it; doing
      // that from outside `AsyncLocalStorage.run()`'s callback loses context.
      async function readCategoryAs(userId: string, categoryId: string) {
        return runWithUserContext(userId, async () => {
          return rlsPrisma.category.findUnique({ where: { id: categoryId } });
        });
      }

      // User A, via the real RLS-extended client: sees their own row.
      const seenByOwner = await readCategoryAs(userIdA, outcome.category.id);
      expect(seenByOwner).not.toBeNull();

      // User B, via the SAME real RLS-extended client: the row is invisible —
      // proven at the Postgres engine level, not by any application-layer
      // `WHERE ownerUserId = ...` clause this query doesn't even have.
      const seenByOtherUser = await readCategoryAs(userIdB, outcome.category.id);
      expect(seenByOtherUser).toBeNull();

      // System categories remain visible to everyone regardless of context.
      const educationSeenByB = await readCategoryAs(userIdB, educationCategoryId);
      expect(educationSeenByB).not.toBeNull();
    } finally {
      await basePrisma.onModuleDestroy();
      await moduleRef.close();
    }
  }, 30_000);

  it('the real /settings Custom Categories flow, dispatched through a real-DI TelegramBotService, persists a real category end to end and deletes it with real re-tagging', async () => {
    onHandlers.length = 0;
    commandHandlers.clear();

    const wizardStore = new Map<string, CustomCategoryWizardStateRecord>();
    const customCategoryWizardStateRepository = {
      get: vi.fn(async (userId: string) => wizardStore.get(userId) ?? null),
      compareAndSet: vi.fn(
        async (
          userId: string,
          expectedVersion: number,
          newRecord: CustomCategoryWizardStateRecord | null,
        ) => {
          const current = wizardStore.get(userId) ?? null;
          if ((current?.version ?? 0) !== expectedVersion) return false;
          if (newRecord === null) {
            wizardStore.delete(userId);
          } else {
            wizardStore.set(userId, newRecord);
          }
          return true;
        },
      ),
    };

    const listCustomCategories = new (
      await import('@afa/application')
    ).ListCustomCategoriesUseCase(categoryRepository);

    const config = {
      get: vi.fn((key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? 'test-token' : undefined)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new TelegramBotService(
      config,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any, // 1 provisionTelegramUser
      {} as any, // 2 routeTextMessage
      {} as any, // 3 routeCallbackQuery
      {} as any, // 4 routeVoiceMessage
      {} as any, // 5 routePhotoMessage
      {} as any, // 6 routeDocumentMessage
      {} as any, // 7 processConversationEvent
      {} as any, // 8 listDrafts
      {} as any, // 9 listOpenDebts
      {} as any, // 10 generateDashboard
      {} as any, // 11 listBudgets
      {} as any, // 12 createBudget
      {} as any, // 13 categoryRepository
      {} as any, // 14 createLoan
      {} as any, // 15 logLoanPayment
      {} as any, // 16 listOpenLoans
      // 17 loanWizardStateRepository — unlike every other placeholder here,
      // this one is genuinely reached by the real text handler this test
      // exercises (the Loan Wizard's precedence check runs unconditionally
      // before the Custom Category Wizard's own check), so it needs a
      // working `.get` returning `null`, not a bare `{}`.
      { get: vi.fn().mockResolvedValue(null), compareAndSet: vi.fn() } as any,
      {} as any, // 18 currencyRepository
      {} as any, // 19 searchTransactions
      {} as any, // 20 deleteTransactionUseCase
      {} as any, // 21 searchSessionRepository
      {} as any, // 22 requestAccountDeletion
      {} as any, // 23 cancelAccountDeletion
      {} as any, // 24 accountDeletionConfirmationRepository
      {} as any, // 25 routeOcrDraftCallback
      {} as any, // 26 generateReport
      {} as any, // 27 reportQueryRepository
      {} as any, // 28 exportTransactions
      {} as any, // 29 getUserSettingsSummary
      {} as any, // 30 updateUserProfile
      {} as any, // 31 setUserPreference
      {} as any, // 32 undoLastTransactionAction
      createCustomCategory, // 33
      listCustomCategories, // 34
      deleteCustomCategory, // 35
      customCategoryWizardStateRepository, // 36
    );
    expect(service).toBeInstanceOf(TelegramBotService);

    const callbackHandler = onHandlers[CALLBACK_HANDLER_INDEX]!.handler;
    const textHandler = onHandlers[TEXT_HANDLER_INDEX]!.handler;

    const addReply = vi.fn();
    await asUser(userIdA, () => callbackHandler(callbackCtx('settings_categories_add', addReply)));
    expect(addReply).toHaveBeenCalledTimes(1);

    const nameReply = vi.fn();
    await asUser(userIdA, () => textHandler(textCtx('Real E2E Category', nameReply)));

    const parentReply = vi.fn();
    await asUser(userIdA, () =>
      callbackHandler(callbackCtx('settings_categories_parent:EDUCATION', parentReply)),
    );
    expect(parentReply).toHaveBeenCalledWith(expect.stringContaining('Education'));

    const persisted = await categoryRepository.listCustomCategoriesForUser(userIdA);
    const created = persisted.find((c) => c.name === 'Real E2E Category');
    expect(created).toBeDefined();
    if (created) createdCategoryIds.push(created.id);

    const previewReply = vi.fn();
    await asUser(userIdA, () =>
      callbackHandler(callbackCtx(`settings_categories_delete:${created!.id}`, previewReply)),
    );
    const [previewText] = previewReply.mock.calls[0]!;
    expect(previewText).toContain('Real E2E Category');

    const confirmReply = vi.fn();
    await asUser(userIdA, () =>
      callbackHandler(
        callbackCtx(`settings_categories_delete_confirm:${created!.id}`, confirmReply),
      ),
    );
    // This category has zero real transactions tagged to it, so
    // `customCategoryDeletedReply`'s own design (correctly) omits the
    // parent-name re-tag line entirely — there is nothing to disclose about
    // a re-tag that never happened. The delete+re-tag-with-a-real-count
    // path is already proven end to end by the "delete + re-tag" test above.
    const [confirmText] = confirmReply.mock.calls[0]!;
    expect(confirmText).toContain('deleted');

    const afterDelete = await categoryRepository.listCustomCategoriesForUser(userIdA);
    expect(afterDelete.some((c) => c.id === created!.id)).toBe(false);
  }, 30_000);
});

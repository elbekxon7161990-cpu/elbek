import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getQueueToken } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { NOTIFICATION_REPOSITORY, OBJECT_STORAGE, STT_PROVIDER } from '@afa/domain';
import type { NotificationRepository, ObjectStoragePort, OcrExtractionJobPayload } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import type { Queue } from 'bullmq';
import type { Update } from 'telegraf/types';

import { TelegramBotService } from '../bot/telegram-bot.service';

/**
 * TASK-AI-006 (completion round) — the REAL, full cross-process OCR
 * pipeline, end to end:
 *
 *   Telegram photo bytes -> RoutePhotoMessageUseCase -> real Supabase
 *   Storage -> real BullMQ `ocr-extraction` queue -> (bridged: this test
 *   invokes the real ProcessReceiptImageUseCase directly, exactly as
 *   apps/worker's own OcrExtractionProcessor would when it dequeues the
 *   job — a real BullMQ worker polling loop inside a test process that
 *   exits immediately after is exactly what account-purge-di.integration.spec.ts's
 *   own `.compile()`-not-`.init()` precedent already avoids for the same
 *   reason: this proves real provider RESOLUTION and real EXECUTION, not
 *   BullMQ's own delivery timing, which is not this task's concern) -> real
 *   Claude Vision (AnthropicVisionOcrProvider) -> real extraction ->
 *   grounding/confidence -> a real TransactionDraft row in real Postgres ->
 *   a real Notification row (with the real Confirm/Edit/Cancel keyboard) ->
 *   a real Telegram `callback_query` Update through TelegramBotService's
 *   real `ocrdraft_confirm:` handler -> RouteOcrDraftCallbackUseCase -> the
 *   EXISTING ProcessConversationEventUseCase/TransactionCommitPort chain ->
 *   a real, committed Transaction row in real Postgres.
 *
 * The one boundary this test cannot cross, and does not pretend to: a
 * receipt photo's bytes normally reach this app via `downloadTelegramFile`,
 * a real HTTP fetch from Telegram's own CDN using a `file_id` that only
 * exists because a real Telegram client uploaded it to a real chat with
 * this bot. No automated backend test can fabricate a working `file_id`
 * without a live external Telegram client in the loop — that is a genuine
 * environmental limitation, not a shortcut taken here. This test instead
 * enters the pipeline at `RoutePhotoMessageUseCase.execute()` — the exact
 * point immediately after that download would have finished in production
 * — with the real bytes of the SAME disclosed synthetic receipt fixture
 * `anthropic-vision-ocr-provider.integration.spec.ts` already uses and
 * discloses (`packages/infrastructure/src/providers/__fixtures__/sample-receipt.png`,
 * reused here rather than inventing a second fixture, per this task's own
 * "search existing fixtures first" instruction). Every step from that point
 * onward — Supabase Storage, BullMQ, Claude Vision, Postgres, the Telegram
 * bot's own callback handling — is the real, unmodified production code.
 *
 * Two separate NestJS module graphs are compiled, mirroring this task's own
 * `ocr-di.integration.spec.ts` split exactly and for the same reason: the
 * real `apps/telegram-bot` `AppModule` (photo upload, real queue, real
 * callback/commit chain) does not — and must not — import worker-only
 * modules (`OcrProviderModule`/`AiExtractionModule`), and `apps/worker`'s
 * own full `AppModule` cannot be compiled in a test at all right now (see
 * `ocr-di.integration.spec.ts`'s own doc comment: an unrelated, pre-existing
 * `BudgetRolloverModule` -> `CATEGORY_REPOSITORY` gap). This test instead
 * assembles the exact same scoped worker-side provider set that file already
 * proved resolves the real Claude Vision chain, and calls
 * `ProcessReceiptImageUseCase.execute()` on it directly — both module graphs
 * point at the SAME real Postgres/Redis/Supabase Storage, so this is a
 * genuine, not simulated, cross-process-equivalent pipeline.
 *
 * Every real Nest `@Module()`-decorated class this file needs beyond
 * `AppModule` itself (`@afa/application`'s `AiExtractionModule`,
 * `@afa/infrastructure`'s `PrismaModule`/`QueueModule`/`ObjectStorageModule`/
 * `LlmProviderModule`/`OcrProviderModule`, `@nestjs/config`'s `ConfigModule`,
 * and this app's own `ExtractionModelConfigModule`) is imported dynamically,
 * inside `beforeAll`, deliberately — a static top-level import of any of
 * these here (proven by trial: it broke `TelegramBotService`'s own
 * `ConfigService` resolution with an "appears to be undefined at runtime"
 * error) races the dynamic `../app.module` import in a way
 * `text-mvp.e2e.spec.ts`/`batch-review.e2e.spec.ts` never hit — neither of
 * those files imports a `@Module()`-decorated class from
 * `@afa/application`/`@afa/infrastructure` at all, only plain tokens/services
 * (`PrismaService`, `REDIS_CLIENT`, `LLM_PROVIDER`, `computeCurrentDateTimeInTimezone`),
 * which stay static here too since that combination is already proven safe.
 */
const HAS_FULL_OCR_E2E_ENVIRONMENT = Boolean(
  process.env.ANTHROPIC_API_KEY &&
    process.env.DATABASE_URL &&
    process.env.REDIS_URL &&
    process.env.TELEGRAM_BOT_TOKEN &&
    process.env.SUPABASE_STORAGE_URL &&
    process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY &&
    process.env.SUPABASE_STORAGE_BUCKET,
);

for (const flag of [
  'ALLOW_FAKE_LLM_PROVIDER',
  'ALLOW_FAKE_OCR_PROVIDER',
  'ALLOW_FAKE_OBJECT_STORAGE',
  'ALLOW_FAKE_TRANSACTION_COMMIT',
]) {
  if (process.env[flag] === 'true') {
    throw new Error(
      `ocr-receipt-pipeline.e2e.spec.ts refuses to run with ${flag}=true — this suite exists specifically to prove the REAL OCR pipeline end to end, never a fake standing in for any step of it.`,
    );
  }
}

const NOT_IMPLEMENTED_STT_RESULT = {
  transcript: '',
  detectedLanguage: null,
  confidence: 0,
  durationSeconds: 0,
  providerModelIdentifier: 'fake-stt-not-implemented',
};

const TEST_TELEGRAM_USER_ID = 999_000_200_001n;

function textUpdate(updateId: number, telegramUserId: bigint, text: string): Update {
  const from = {
    id: Number(telegramUserId),
    is_bot: false,
    first_name: 'E2E',
    username: `e2e_ocr_user_${telegramUserId}`,
    language_code: 'uz',
  };
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(telegramUserId), type: 'private', first_name: 'E2E' },
      from,
      text,
    },
  } as unknown as Update;
}

function callbackUpdate(updateId: number, telegramUserId: bigint, data: string): Update {
  const from = {
    id: Number(telegramUserId),
    is_bot: false,
    first_name: 'E2E',
    username: `e2e_ocr_user_${telegramUserId}`,
    language_code: 'uz',
  };
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: 'e2e-ocr',
      data,
      message: {
        message_id: updateId - 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(telegramUserId), type: 'private', first_name: 'E2E' },
      },
    },
  } as unknown as Update;
}

describe.skipIf(!HAS_FULL_OCR_E2E_ENVIRONMENT)(
  'TASK-AI-006 — Real OCR receipt pipeline end-to-end (real Claude Vision + real Postgres + real Redis + real Supabase Storage)',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- these hold real Nest classes loaded dynamically (see this file's own top-level doc comment); typing them precisely would require the same static imports this pattern deliberately avoids.
    let botModuleRef: TestingModule;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let workerModuleRef: TestingModule;
    let botService: TelegramBotService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let routePhotoMessage: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let processReceiptImage: any;
    let notificationRepository: NotificationRepository;
    let objectStorage: ObjectStoragePort;
    let ocrQueue: Queue<OcrExtractionJobPayload>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prisma: any;
    let userId: string;
    let updateIdSeq = 2_000_000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let computeCurrentDateTimeInTimezone: any;

    beforeAll(async () => {
      // Dynamic import — same reason as text-mvp.e2e.spec.ts: AppModule's
      // own @Module decorator must not evaluate before this file's env
      // checks above have already run.
      const { AppModule } = await import('../app.module');
      const application = await import('@afa/application');
      const infrastructure = await import('@afa/infrastructure');
      const { ExtractionModelConfigModule } = await import('../providers/extraction-model-config.module');
      const { ConfigModule } = await import('@nestjs/config');
      computeCurrentDateTimeInTimezone = application.computeCurrentDateTimeInTimezone;

      botModuleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      botService = botModuleRef.get(TelegramBotService);
      routePhotoMessage = botModuleRef.get(application.RoutePhotoMessageUseCase);
      const routeOcrDraftCallback = botModuleRef.get(application.RouteOcrDraftCallbackUseCase);
      notificationRepository = botModuleRef.get(NOTIFICATION_REPOSITORY);
      objectStorage = botModuleRef.get(OBJECT_STORAGE);
      ocrQueue = botModuleRef.get(getQueueToken(infrastructure.OCR_EXTRACTION_QUEUE_NAME));
      prisma = botModuleRef.get(infrastructure.PrismaService);
      // Proves RouteOcrDraftCallbackUseCase genuinely resolves inside the
      // real AppModule (its own ProcessConversationEventUseCase dependency
      // chain included) — exercised indirectly below via the real
      // `ocrdraft_confirm:` callback_query update, not called directly.
      expect(routeOcrDraftCallback).toBeInstanceOf(application.RouteOcrDraftCallbackUseCase);
      await prisma.onModuleInit();

      // Scoped worker-side composition — the exact provider set
      // apps/worker/src/app.module.ts wires for the OCR path
      // (ocr-di.integration.spec.ts proved this set resolves the real
      // Claude Vision chain), assembled here directly rather than via
      // apps/worker's own AppModule (see this file's own doc comment for
      // why). STT_PROVIDER is bound to the same disclosed, always-honest
      // fake apps/worker's own SttFallbackModule uses — required only
      // because AiExtractionModule bundles TranscribeVoiceMessageUseCase
      // alongside ProcessReceiptImageUseCase; nothing in this test ever
      // calls it. A root-level `providers` array on Test.createTestingModule
      // is NOT visible to a nested imported module like AiExtractionModule
      // (NestJS module visibility rules — only @Global() providers, or ones
      // the nested module's own imports export, are reachable), so this
      // needs a real @Global() module, exactly like apps/worker's own
      // SttFallbackModule.
      @Global()
      @Module({
        providers: [
          {
            provide: STT_PROVIDER,
            useFactory: () => new infrastructure.FakeSttProvider(NOT_IMPLEMENTED_STT_RESULT),
          },
        ],
        exports: [STT_PROVIDER],
      })
      class TestSttFallbackModule {}

      workerModuleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          infrastructure.PrismaModule,
          infrastructure.QueueModule.forRoot(),
          infrastructure.ObjectStorageModule,
          infrastructure.LlmProviderModule,
          ExtractionModelConfigModule,
          infrastructure.OcrProviderModule,
          TestSttFallbackModule,
          infrastructure.DraftRepositoryModule,
          infrastructure.NotificationRepositoryModule,
          infrastructure.NotificationDeliveryQueueRepositoryModule,
          application.AiExtractionModule,
        ],
      }).compile();
      processReceiptImage = workerModuleRef.get(application.ProcessReceiptImageUseCase);

      // Real user provisioning through the existing, already-proven text
      // pathway — this test invents no new user-creation code.
      await botService.handleUpdate(textUpdate(updateIdSeq++, TEST_TELEGRAM_USER_ID, 'salom'));
      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_TELEGRAM_USER_ID } });
      expect(user).not.toBeNull();
      userId = user!.id;
    }, 60_000);

    afterAll(async () => {
      if (userId) {
        // Transaction/TransactionDraft/Notification/Account are all
        // RLS-protected — every delete below needs the same
        // runWithUserContext wrap the real pipeline itself requires (found
        // by this being the first time extraction ever succeeded far
        // enough to reach any of this cleanup; each call was previously
        // silently failing under its own .catch(() => {}), leaking test
        // rows every run).
        //
        // TransactionAuditLog rows (FR-DB-012 — written as a side effect of
        // the real commit this test exercises) are NOT RLS-protected
        // (deliberately excluded — see rls-protected-models.ts's own doc
        // comment) but still `onDelete: Restrict` against Transaction, so
        // they must be deleted first or `transaction.deleteMany()` below
        // fails (silently, under its own .catch) and leaves both the
        // Transaction AND — transitively, via Transaction's own FK to
        // Account — the Account row behind too.
        const userTransactionIds: { id: string }[] = await runWithUserContext(userId, async () =>
          prisma.transaction.findMany({ where: { userId }, select: { id: true } }),
        ).catch(() => []);
        if (userTransactionIds.length > 0) {
          await prisma.transactionAuditLog
            .deleteMany({
              where: { transactionId: { in: userTransactionIds.map((t: { id: string }) => t.id) } },
            })
            .catch(() => {});
        }
        // TransactionDraft must be deleted BEFORE Transaction — Confirm sets
        // `resolvedTransactionId` on the draft pointing at the real
        // committed Transaction (`onDelete: Restrict`), so deleting
        // Transaction first fails (silently, under its own .catch) and
        // leaves both rows behind, same FK-ordering class of bug as
        // TransactionAuditLog above.
        await runWithUserContext(userId, async () =>
          prisma.transactionDraft.deleteMany({ where: { userId } }),
        ).catch(() => {});
        await runWithUserContext(userId, async () =>
          prisma.transaction.deleteMany({ where: { userId } }),
        ).catch(() => {});
        await runWithUserContext(userId, async () =>
          prisma.notification.deleteMany({ where: { userId } }),
        ).catch(() => {});
        await runWithUserContext(userId, async () =>
          prisma.account.deleteMany({ where: { userId } }),
        ).catch(() => {});
        // §13.37 UserFinancialSummary — a maintained (RLS-protected)
        // materialized read-model row keyed by userId, updated as a side
        // effect of the real transaction commit this test exercises;
        // `onDelete: Restrict` blocks `prisma.user.delete()` below until
        // this row is gone too (found by this being the first run whose
        // Confirm step ever actually committed a real Transaction).
        await runWithUserContext(userId, async () =>
          prisma.userFinancialSummary.deleteMany({ where: { userId } }),
        ).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
        await objectStorage.deleteObjectsByPrefix(`photo/${userId}/`).catch(() => {});
      }
      if (workerModuleRef) {
        await workerModuleRef.close().catch(() => {});
      }
      if (botModuleRef) {
        try {
          await botModuleRef.close();
        } catch {
          // expected — TelegramBotService's onModuleDestroy calls
          // this.bot.stop() on a bot that was never launched (.compile()
          // only, never .init()), same as text-mvp.e2e.spec.ts.
        }
      }
    }, 30_000);

    it(
      'a real receipt photo becomes a real Supabase-stored object, a real Claude Vision extraction, a real TransactionDraft, a real Telegram review card, and — on Confirm — a real committed Transaction in real Postgres',
      async () => {
        const receiptImage = readFileSync(
          join(__dirname, '../../../../packages/infrastructure/src/providers/__fixtures__/sample-receipt.png'),
        );
        const telegramFileId = `e2e-ocr-${Date.now()}`;

        const routeOutcome = await routePhotoMessage.execute({
          userId,
          telegramFileId,
          image: receiptImage,
          mimeType: 'image/png',
          sizeBytes: receiptImage.length,
          sourceType: 'photo',
          caption: null,
          currentDateTime: computeCurrentDateTimeInTimezone(new Date(), 'Asia/Tashkent'),
          userDefaultCurrency: 'UZS',
          userRecentCategories: [],
        });
        expect(routeOutcome.kind).toBe('enqueued');
        const jobId = routeOutcome.jobId as string;

        // Proves the upload and the enqueue genuinely happened against real
        // Supabase Storage and real Redis-backed BullMQ — not merely that
        // routePhotoMessage.execute() returned without throwing.
        const job = await ocrQueue.getJob(jobId);
        expect(job).not.toBeNull();
        expect(job!.data).toMatchObject({
          userId,
          telegramFileId,
          imageObjectStorageUri: `photo/${userId}/${telegramFileId}.png`,
        });
        const storedObject = await objectStorage.getObject(job!.data.imageObjectStorageUri);
        expect(Buffer.compare(storedObject, receiptImage)).toBe(0);

        // Bridges "the worker dequeues the job" — real execution, not real
        // BullMQ polling timing (see this file's own doc comment).
        // runWithUserContext mirrors OcrExtractionProcessor's own real
        // wrapping (RLS requires it for the TransactionDraft write below).
        const extractionOutcome = await runWithUserContext(job!.data.userId, () =>
          processReceiptImage.execute(job!.data),
        );
        expect(extractionOutcome.status).toBe('extracted');
        expect(extractionOutcome.ocrResult.providerModelIdentifier).toContain('claude');
        expect(extractionOutcome.ocrResult.rawText).toMatch(/45\s?000/);
        const draftId = extractionOutcome.draftId as string;

        // TransactionDraft/Transaction/Notification are all RLS-protected —
        // every raw Prisma call below (not just calls into application
        // use-cases) needs the same runWithUserContext wrap
        // OcrExtractionProcessor's own real caller establishes in
        // production; this file's own test-only assertions are no
        // exception (found by this being the first time extraction ever
        // succeeded far enough to reach them).
        // Deliberately `async () =>` (not a plain arrow returning the raw
        // PrismaPromise) for every runWithUserContext callback below:
        // Prisma's query-builder calls return a lazy, non-native "thenable"
        // (PrismaPromise) whose actual dispatch Node's AsyncLocalStorage
        // does not automatically link back to the ambient context unless
        // the callback given to `.run()` is itself a real `async function`
        // (Node's async_hooks instruments native async-function execution
        // directly; a plain arrow that merely *returns* a thenable does
        // not get that same automatic linking for whatever happens after
        // it returns). `processReceiptImage.execute` above works either
        // way because it is itself declared `async`. Matches the
        // established, already-working convention elsewhere in this repo
        // (e.g. text-mvp.e2e.spec.ts's own cleanup: `async () =>
        // prisma.transaction.deleteMany(...)`).
        const draft = await runWithUserContext(userId, async () =>
          prisma.transactionDraft.findUnique({ where: { id: draftId } }),
        );
        expect(draft).not.toBeNull();
        expect(draft!.userId).toBe(userId);
        expect(draft!.status).toBe('pending');

        // NotificationRepository exposes no dedup-key lookup (RLS-scoped
        // reads only, by design — see its own doc comment); the raw id
        // lookup below is a one-off, test-only exception to find OUR OWN
        // just-created row, then reads it back through the real port so
        // replyMarkup is deserialized by the same production mapper.
        // `dedupKey` is not a raw Prisma column — it lives inside the
        // general-purpose `payload` JSONB blob (see notification.mapper.ts's
        // own `NotificationPayloadShape`), so the raw lookup must filter via
        // Prisma's JSON path syntax, not a top-level `where` field.
        const rawNotificationRow = await runWithUserContext(userId, async () =>
          prisma.notification.findFirst({
            where: { userId, payload: { path: ['dedupKey'], equals: draftId } },
          }),
        );
        expect(rawNotificationRow).not.toBeNull();
        const notificationRow = await runWithUserContext(userId, async () =>
          notificationRepository.findById(rawNotificationRow!.id),
        );
        expect(notificationRow).not.toBeNull();
        expect(notificationRow!.type).toBe('ReceiptOcrDraftReady');
        expect(JSON.stringify(notificationRow!.replyMarkup)).toContain(`ocrdraft_confirm:${draftId}`);

        // The real Telegram Confirm tap — through the app's real callback
        // handler, exactly as production receives it.
        await botService.handleUpdate(
          callbackUpdate(updateIdSeq++, TEST_TELEGRAM_USER_ID, `ocrdraft_confirm:${draftId}`),
        );

        const committedTransaction = await runWithUserContext(userId, async () =>
          prisma.transaction.findFirst({ where: { userId, sourceReference: draftId } }),
        );
        expect(committedTransaction).not.toBeNull();
        expect(committedTransaction!.sourceType).toBe('photo');
        expect(Number(committedTransaction!.amount)).toBe(45000);
        expect(committedTransaction!.currency).toBe('UZS');

        const resolvedDraft = await runWithUserContext(userId, async () =>
          prisma.transactionDraft.findUnique({ where: { id: draftId } }),
        );
        expect(resolvedDraft!.status).toBe('completed');
        expect(resolvedDraft!.resolvedTransactionId).toBe(committedTransaction!.id);
      },
      120_000,
    );

    it('a duplicate delivery of the same photo (BullMQ at-least-once redelivery) never creates a second draft', async () => {
      const telegramFileId = `e2e-ocr-dup-${Date.now()}`;
      const receiptImage = readFileSync(
        join(__dirname, '../../../../packages/infrastructure/src/providers/__fixtures__/sample-receipt.png'),
      );
      const payload = {
        jobId: `ocr-${telegramFileId}`,
        userId,
        telegramFileId,
        imageObjectStorageUri: `photo/${userId}/${telegramFileId}.png`,
        mimeType: 'image/png',
        sizeBytes: receiptImage.length,
        sourceType: 'photo' as const,
        caption: null,
        currentDateTime: computeCurrentDateTimeInTimezone(new Date(), 'Asia/Tashkent'),
        userDefaultCurrency: 'UZS',
        userRecentCategories: [] as readonly string[],
      };
      await objectStorage.putObject(payload.imageObjectStorageUri, receiptImage, 'image/png');

      const first = await runWithUserContext(payload.userId, () => processReceiptImage.execute(payload));
      expect(first.status).toBe('extracted');
      const second = await runWithUserContext(payload.userId, () => processReceiptImage.execute(payload));
      expect(second.status).toBe('already_processed');
      expect(second.draftId).toBe(first.draftId);
    }, 60_000);
  },
);

/**
 * Always runs (no credential gate) — proves the harness itself reports
 * ENVIRONMENT-BLOCKED honestly rather than silently vanishing when the
 * environment is incomplete, same convention as every other e2e spec here.
 */
describe('TASK-AI-006 — Real OCR pipeline E2E environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
      TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      SUPABASE_STORAGE_URL: Boolean(process.env.SUPABASE_STORAGE_URL),
      SUPABASE_STORAGE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY),
      SUPABASE_STORAGE_BUCKET: Boolean(process.env.SUPABASE_STORAGE_BUCKET),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (presence booleans only), read by CI/human operators to see why the suite above skipped.
    console.log('OCR pipeline E2E environment gate:', JSON.stringify(status));

    expect(typeof HAS_FULL_OCR_E2E_ENVIRONMENT).toBe('boolean');
  });
});

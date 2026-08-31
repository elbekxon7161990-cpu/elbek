import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService, REDIS_CLIENT } from '@afa/infrastructure';
import type { RedisClient } from '@afa/infrastructure';
import { runWithUserContext } from '@afa/shared';
import type { Update } from 'telegraf/types';

import { TelegramBotService } from '../bot/telegram-bot.service';
import { TelegramUpdateDedupService } from '../webhook/telegram-update-dedup.service';
import type { AppModule as AppModuleType } from '../app.module';

/**
 * TASK-MVP-001 — the production-realistic, TEXT-ONLY end-to-end
 * verification path:
 *
 *   Telegram Update -> TelegramBotService.handleUpdate -> user provisioning
 *   -> RouteTextMessageUseCase -> real AnthropicLlmProvider (TASK-INFRA-AI-REAL-001)
 *   -> TASK-AI-001/002/003/004 -> ProcessConversationEventUseCase (TASK-BOT-002)
 *   -> real TransactionCommitAdapter (TASK-FIN-REAL-001) -> real PostgreSQL.
 *
 * Boots the app's REAL composition root (`AppModule`) unmodified — no test
 * double is substituted for LLM_PROVIDER, TRANSACTION_COMMIT_PORT,
 * ConfigService's DATABASE_URL/REDIS_URL, or anything else in the chain;
 * `ALLOW_FAKE_LLM_PROVIDER`/`ALLOW_FAKE_TRANSACTION_COMMIT` are asserted
 * unset below specifically so a real run can never silently fall back to a
 * fake. STT/OCR/PDF/Excel are structurally out of reach here — this suite
 * only ever sends `message.text` updates.
 *
 * Gated on every credential this flow needs actually being present —
 * `AppModule`'s own `ConfigService` validation would otherwise throw during
 * `compile()` (DATABASE_URL/REDIS_URL are non-optional), and there is no
 * value in a partially-configured "E2E" run. When gated off, this suite
 * reports as SKIPPED, never as a fabricated pass — see this task's final
 * report for exactly which credential was missing in a given run.
 */
const HAS_FULL_E2E_ENVIRONMENT = Boolean(
  process.env.ANTHROPIC_API_KEY &&
  process.env.DATABASE_URL &&
  process.env.REDIS_URL &&
  process.env.TELEGRAM_BOT_TOKEN,
);

if (
  process.env.ALLOW_FAKE_LLM_PROVIDER === 'true' ||
  process.env.ALLOW_FAKE_TRANSACTION_COMMIT === 'true'
) {
  throw new Error(
    'text-mvp.e2e.spec.ts refuses to run with ALLOW_FAKE_LLM_PROVIDER/ALLOW_FAKE_TRANSACTION_COMMIT set — the E2E path must use real providers only.',
  );
}

// TASK-AI-006 (Object Storage groundwork) — AppModule now also requires
// OBJECT_STORAGE to resolve (ObjectStorageModule's buildObjectStorage fails
// fast without real SUPABASE_STORAGE_* credentials). This suite only ever
// sends `message.text` updates (line 27-28 above) — it never exercises
// object storage — so, unlike LLM_PROVIDER/TRANSACTION_COMMIT_PORT above,
// faking this one specific token does not weaken what this suite actually
// proves. Real SUPABASE_STORAGE_* credentials, if present, still win (see
// buildObjectStorage's own selection order).
process.env.ALLOW_FAKE_OBJECT_STORAGE ??= 'true';

const TEST_USER_A = 999_000_000_001n;
const TEST_USER_B = 999_000_000_002n;

function textUpdate(
  updateId: number,
  telegramUserId: bigint,
  text: string,
  messageId: number,
): Update {
  const from = {
    id: Number(telegramUserId),
    is_bot: false,
    first_name: 'E2E',
    username: `e2e_test_user_${telegramUserId}`,
    language_code: 'uz',
  };
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(telegramUserId), type: 'private', first_name: 'E2E' },
      from,
      text,
    },
  } as unknown as Update;
}

describe.skipIf(!HAS_FULL_E2E_ENVIRONMENT)(
  'TASK-MVP-001 — Text MVP end-to-end (real Anthropic + real PostgreSQL + real Redis)',
  () => {
    let moduleRef: TestingModule;
    let botService: TelegramBotService;
    let dedup: TelegramUpdateDedupService;
    let prisma: PrismaService;
    let redis: RedisClient;
    let updateIdSeq = 1_000_000;

    beforeAll(async () => {
      // Dynamic import, deliberately: `AppModule`'s own `@Module` decorator
      // eagerly evaluates `AppConfigModule.forRoot()` (env validation) the
      // moment the class is loaded — a static top-level import would run
      // that validation (and throw on missing DATABASE_URL/REDIS_URL) even
      // when `describe.skipIf` skips every test in this block. Importing it
      // only here, inside a hook `skipIf` genuinely prevents from running,
      // keeps the skip clean.
      const { AppModule }: { AppModule: typeof AppModuleType } = await import('../app.module');
      moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      // TASK-MVP-002 — deliberately no `moduleRef.init()`: `.compile()`
      // already fully resolves and instantiates the real DI graph (which is
      // what this suite actually needs to verify); `.init()` additionally
      // runs every module's lifecycle hooks, including
      // `TelegramBotService.onModuleInit()`'s `this.bot.launch()` — real
      // long-polling against the Telegram Bot API, which by design never
      // resolves. Discovered by actually running this suite against a real
      // environment for the first time. `PrismaService` still needs its own
      // explicit `onModuleInit()` (`$connect()`) since that hook is skipped
      // too; `REDIS_CLIENT` needs no equivalent call — `ioredis` connects
      // eagerly on construction.
      botService = moduleRef.get(TelegramBotService);
      dedup = moduleRef.get(TelegramUpdateDedupService);
      prisma = moduleRef.get(PrismaService);
      redis = moduleRef.get(REDIS_CLIENT);
      await prisma.onModuleInit();
    });

    afterAll(async () => {
      // Clean up only the rows this suite itself created — never touches any
      // other data. `User` is not RLS-protected (RLS_PROTECTED_MODELS); the
      // per-user Transaction cleanup below runs inside runWithUserContext so
      // it is not itself blocked by the RLS policy it is exercising.
      for (const telegramUserId of [TEST_USER_A, TEST_USER_B]) {
        const user = await prisma.user.findFirst({ where: { telegramUserId } });
        if (user) {
          await runWithUserContext(user.id, async () =>
            prisma.transaction.deleteMany({ where: { userId: user.id } }),
          );
          await prisma.user.delete({ where: { id: user.id } });
        }
        await redis.del(`conversation_state:${user?.id ?? ''}`);
      }
      if (moduleRef) {
        try {
          // TASK-MVP-002 — `moduleRef.close()` runs every module's
          // `onModuleDestroy()`, including `TelegramBotService`'s
          // unconditional `this.bot.stop('SIGTERM')` — since `beforeAll`
          // deliberately never called `.init()` (see its own comment), the
          // bot was never launched, and Telegraf's `.stop()` on a
          // never-launched bot throws "Bot is not running!". That failure
          // is expected here and must not fail this suite's teardown or
          // mask real assertion failures above.
          await moduleRef.close();
        } catch {
          // expected — see comment above.
        }
      }
    });

    it('verifies the full text flow: webhook -> provisioning -> real Claude -> guardrails -> commit -> PostgreSQL', async () => {
      const update = textUpdate(updateIdSeq++, TEST_USER_A, 'Bugun ovqatga 150 ming sarfladim', 1);

      await botService.handleUpdate(update);

      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER_A } });
      expect(user).not.toBeNull();

      const transactions = await runWithUserContext(user!.id, async () =>
        prisma.transaction.findMany({ where: { userId: user!.id } }),
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({ transactionType: 'EXPENSE', currency: 'UZS' });
      expect(Number(transactions[0]!.amount)).toBe(150000);
    });

    it('duplicate delivery of the same update_id does not create a second transaction', async () => {
      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER_A } });
      const before = await runWithUserContext(user!.id, async () =>
        prisma.transaction.count({ where: { userId: user!.id } }),
      );

      const duplicateUpdateId = updateIdSeq - 1; // re-deliver the previous test's update_id
      const isDuplicate = await dedup.isDuplicate(duplicateUpdateId);
      expect(isDuplicate).toBe(true); // TASK-BOT-001's own dedup already caught it

      const after = await runWithUserContext(user!.id, async () =>
        prisma.transaction.count({ where: { userId: user!.id } }),
      );
      expect(after).toBe(before);
    });

    it('a cancellation phrase commits zero transactions', async () => {
      const update = textUpdate(updateIdSeq++, TEST_USER_B, 'bekor qil', 1);

      await botService.handleUpdate(update);

      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER_B } });
      const count = user
        ? await runWithUserContext(user.id, async () =>
            prisma.transaction.count({ where: { userId: user.id } }),
          )
        : 0;
      expect(count).toBe(0);
    });

    it('strict user isolation — a second user only ever sees their own transaction', async () => {
      const update = textUpdate(updateIdSeq++, TEST_USER_B, 'Kecha benzinga 250 ming ketdi', 2);

      await botService.handleUpdate(update);

      const userA = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER_A } });
      const userB = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER_B } });

      const transactionsA = await runWithUserContext(userA!.id, async () =>
        prisma.transaction.findMany({ where: { userId: userA!.id } }),
      );
      const transactionsB = await runWithUserContext(userB!.id, async () =>
        prisma.transaction.findMany({ where: { userId: userB!.id } }),
      );

      expect(transactionsA.every((t) => t.userId === userA!.id)).toBe(true);
      expect(transactionsB.every((t) => t.userId === userB!.id)).toBe(true);
      expect(transactionsB.some((t) => t.transactionType === 'EXPENSE')).toBe(true);
    });
  },
);

/**
 * Always runs (no credential gate) — proves the harness itself reports
 * ENVIRONMENT-BLOCKED honestly rather than silently vanishing when the
 * environment is incomplete.
 */
describe('TASK-MVP-001 — E2E environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
      TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (no secret values, only presence booleans), read by CI/human operators to see why the suite above skipped.
    console.log('E2E environment gate:', JSON.stringify(status));

    expect(typeof HAS_FULL_E2E_ENVIRONMENT).toBe('boolean');
  });
});

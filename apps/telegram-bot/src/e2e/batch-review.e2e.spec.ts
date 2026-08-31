import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { LLM_PROVIDER } from '@afa/domain';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';
import { PrismaService, REDIS_CLIENT } from '@afa/infrastructure';
import type { RedisClient } from '@afa/infrastructure';
import { runWithUserContext } from '@afa/shared';
import type { Update } from 'telegraf/types';

import { TelegramBotService } from '../bot/telegram-bot.service';
import type { AppModule as AppModuleType } from '../app.module';

/**
 * TASK-BOT-006 (§5.7, compound-text path) — the same real-composition-root
 * treatment `text-mvp.e2e.spec.ts` (TASK-MVP-001) already established:
 * boots the REAL `AppModule` (real PostgreSQL via `PrismaService`, real
 * Redis conversation-state CAS, the real `TransactionCommitAdapter` ->
 * `CreateExpenseUseCase` chain), driving everything through
 * `TelegramBotService.handleUpdate` exactly as production would.
 *
 * The one deliberate substitution: `LLM_PROVIDER` is overridden with a
 * scripted fake. TASK-AI's own suites already cover real-Claude extraction
 * quality; this suite's job is to verify the NEW multi-item persistence and
 * state-machine wiring (N drafts in real Postgres, real
 * AWAITING_MULTI_ITEM_REVIEW CAS in real Redis, real per-item commits)
 * end-to-end — a real, non-deterministic confidence band from a live model
 * call would make that unverifiable without flaking. Every other adapter in
 * the chain (Postgres, Redis, TransactionCommitPort, CategoryRepository,
 * idempotency lock) is the real, production one.
 */
const HAS_ENVIRONMENT_FOR_THIS_SUITE = Boolean(
  process.env.DATABASE_URL && process.env.REDIS_URL && process.env.TELEGRAM_BOT_TOKEN,
);

// TASK-AI-006 (Object Storage groundwork) — AppModule now also requires
// OBJECT_STORAGE to resolve; this suite only ever sends `message.text`/
// callback-query updates, never exercising object storage, so faking this
// one specific token (same reasoning as text-mvp.e2e.spec.ts) does not
// weaken what this suite actually proves. Real SUPABASE_STORAGE_*
// credentials, if present, still win.
process.env.ALLOW_FAKE_OBJECT_STORAGE ??= 'true';

const TEST_USER = 999_000_100_001n;

function textUpdate(updateId: number, telegramUserId: bigint, text: string): Update {
  const from = {
    id: Number(telegramUserId),
    is_bot: false,
    first_name: 'E2E',
    username: `e2e_batch_user_${telegramUserId}`,
    language_code: 'en',
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
    username: `e2e_batch_user_${telegramUserId}`,
    language_code: 'en',
  };
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: 'e2e',
      data,
      message: {
        message_id: updateId - 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(telegramUserId), type: 'private', first_name: 'E2E' },
      },
    },
  } as unknown as Update;
}

/** A compound-message extraction envelope: one auto_commit-band candidate (Lunch) and one deliberately low-confidence candidate (Coffee, amount confidence 0.3) — mirrors the exact fixture shape already proven deterministic in route-text-message.use-case.spec.ts's own TASK-BOT-006 suite. */
function compoundEnvelope(): Record<string, unknown> {
  const highConfidence = {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-08-15',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
  };
  const lowConfidence = {
    ...highConfidence,
    amount: 12000,
    description: 'Coffee',
    confidenceScores: {
      intent: 0.97,
      amount: 0.3,
      currency: 0.9,
      category: 0.6,
      transactionDate: 0.9,
    },
  };
  return {
    transactions: [highConfidence, lowConfidence],
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}

class ScriptedLlmProvider implements LlmProvider {
  constructor(private readonly result: LlmCompletionResult) {}
  async complete(_request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return this.result;
  }
}

describe.skipIf(!HAS_ENVIRONMENT_FOR_THIS_SUITE)(
  'TASK-BOT-006 — Multi-Item Review Flow end-to-end (real PostgreSQL + real Redis, scripted extraction)',
  () => {
    let moduleRef: TestingModule;
    let botService: TelegramBotService;
    let prisma: PrismaService;
    let redis: RedisClient;
    let updateIdSeq = 2_000_000;

    beforeAll(async () => {
      // Dynamic import — same reason as text-mvp.e2e.spec.ts: AppModule's
      // env validation runs at class-decoration time and must not run when
      // this suite is skipped.
      const { AppModule }: { AppModule: typeof AppModuleType } = await import('../app.module');
      moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(LLM_PROVIDER)
        .useValue(
          new ScriptedLlmProvider({
            content: JSON.stringify(compoundEnvelope()),
            finishReason: 'stop',
          }),
        )
        .compile();

      botService = moduleRef.get(TelegramBotService);
      prisma = moduleRef.get(PrismaService);
      redis = moduleRef.get(REDIS_CLIENT);
      await prisma.onModuleInit();
    });

    afterAll(async () => {
      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER } });
      if (user) {
        await runWithUserContext(user.id, async () => {
          await prisma.transaction.deleteMany({ where: { userId: user.id } });
          await prisma.transactionDraft.deleteMany({ where: { userId: user.id } });
        });
        await prisma.user.delete({ where: { id: user.id } });
        await redis.del(`conversation_state:${user.id}`);
      }
      if (moduleRef) {
        try {
          await moduleRef.close();
        } catch {
          // expected — see text-mvp.e2e.spec.ts's own comment (bot never launched via .init()).
        }
      }
    });

    it('a compound message creates one real draft per candidate, commits nothing yet, and writes a real AWAITING_MULTI_ITEM_REVIEW record to Redis', async () => {
      await botService.handleUpdate(
        textUpdate(updateIdSeq++, TEST_USER, 'spent 45000 on lunch and something on coffee'),
      );

      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER } });
      expect(user).not.toBeNull();

      const drafts = await runWithUserContext(user!.id, async () =>
        prisma.transactionDraft.findMany({ where: { userId: user!.id } }),
      );
      expect(drafts).toHaveLength(2);
      expect(drafts.every((d) => d.status === 'pending')).toBe(true);

      const transactions = await runWithUserContext(user!.id, async () =>
        prisma.transaction.findMany({ where: { userId: user!.id } }),
      );
      expect(transactions).toHaveLength(0); // nothing auto-committed — even the high-confidence item waits

      const raw = await redis.get(`conversation_state:${user!.id}`);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!) as { state: string; contextPayload: Record<string, unknown> };
      expect(stored.state).toBe('AWAITING_MULTI_ITEM_REVIEW');
      expect(stored.contextPayload.totalItems).toBe(2);
      expect(stored.contextPayload.currentIndex).toBe(0);
    });

    it('confirming the one low-confidence item commits a real transaction, marks its draft completed, and returns conversation state to IDLE in real Redis (FR-CE-032/033)', async () => {
      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER } });
      const raw = await redis.get(`conversation_state:${user!.id}`);
      const stored = JSON.parse(raw!) as {
        contextPayload: { lowConfidenceDraftIds: string[]; highConfidenceDraftIds: string[] };
      };
      const lowConfidenceDraftId = stored.contextPayload.lowConfidenceDraftIds[0]!;

      await botService.handleUpdate(
        callbackUpdate(updateIdSeq++, TEST_USER, `batch_confirm:${lowConfidenceDraftId}`),
      );

      const transactions = await runWithUserContext(user!.id, async () =>
        prisma.transaction.findMany({ where: { userId: user!.id } }),
      );
      expect(transactions).toHaveLength(1);
      expect(Number(transactions[0]!.amount)).toBe(12000); // the Coffee (low-confidence) candidate

      const draft = await runWithUserContext(user!.id, async () =>
        prisma.transactionDraft.findUniqueOrThrow({ where: { id: lowConfidenceDraftId } }),
      );
      expect(draft.status).toBe('completed');
      expect(draft.resolvedTransactionId).toBe(transactions[0]!.id);

      const rawAfter = await redis.get(`conversation_state:${user!.id}`);
      expect(rawAfter).toBeNull(); // IDLE is stored as no key (TASK-BOT-002's own convention)
    });

    it('a duplicate replay of the same batch_confirm callback is safely reported stale by the guard table — never a second transaction', async () => {
      const user = await prisma.user.findFirst({ where: { telegramUserId: TEST_USER } });
      const drafts = await runWithUserContext(user!.id, async () =>
        prisma.transactionDraft.findMany({
          where: { userId: user!.id },
          orderBy: { createdAt: 'asc' },
        }),
      );
      const completedDraft = drafts.find((d) => d.status === 'completed')!;

      const before = await runWithUserContext(user!.id, async () =>
        prisma.transaction.count({ where: { userId: user!.id } }),
      );

      await botService.handleUpdate(
        callbackUpdate(updateIdSeq++, TEST_USER, `batch_confirm:${completedDraft.id}`),
      );

      const after = await runWithUserContext(user!.id, async () =>
        prisma.transaction.count({ where: { userId: user!.id } }),
      );
      expect(after).toBe(before); // state is IDLE now — the replayed tap has nothing to match against
    });
  },
);

describe('TASK-BOT-006 — E2E environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
      TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (presence booleans only), read by CI/human operators to see why the suite above skipped.
    console.log('TASK-BOT-006 E2E environment gate:', JSON.stringify(status));

    expect(typeof HAS_ENVIRONMENT_FOR_THIS_SUITE).toBe('boolean');
  });
});

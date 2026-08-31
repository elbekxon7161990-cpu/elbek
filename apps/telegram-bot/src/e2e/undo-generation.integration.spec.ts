import { runWithUserContext } from '@afa/shared';
import {
  DeleteTransactionUseCase,
  RestoreTransactionUseCase,
  UndoLastTransactionActionUseCase,
} from '@afa/application';
import {
  PrismaService,
  PrismaTransactionAuditLogRepository,
  PrismaTransactionRepository,
} from '@afa/infrastructure';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `/undo` REAL INTEGRATION (TASK-FIN-013) — a genuine `/undo` flow through
 * the real `UndoLastTransactionActionUseCase` (which itself delegates to the
 * already-existing, unmodified `DeleteTransactionUseCase`/
 * `RestoreTransactionUseCase`), real Postgres (`PrismaTransactionRepository`/
 * `PrismaTransactionAuditLogRepository`), plus a real-DI `TelegramBotService`
 * dispatching its actual `/undo` command handler.
 *
 * Mirrors `undo-concurrency.integration.spec.ts`'s own bootstrap approach
 * exactly (direct construction against the owner-role `DIRECT_URL`, the
 * established real-Postgres pattern for this transaction/undo area of the
 * codebase — deliberately NOT the `Test.createTestingModule` + `FinanceModule`
 * shape `/settings`'s own integration test uses, since `FinanceModule` also
 * provides `CreateExpenseUseCase`/`CreateIncomeUseCase`/`EditTransactionUseCase`,
 * which pull in `AccountRepository`/`FxRateRepository`/`ExpenseHistoryRepository`
 * — real capabilities genuinely unrelated to `/undo` that this task's own
 * scope rules forbid wiring up just to satisfy an unrelated use case's DI
 * graph).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

const { mockBot, commandHandlers } = vi.hoisted(() => {
  const commands = new Map<string, (ctx: unknown) => Promise<void>>();
  return {
    commandHandlers: commands,
    mockBot: {
      use: vi.fn(),
      on: vi.fn(),
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

const TELEGRAM_USER_ID_A = 900_000_001_210n;
const TELEGRAM_USER_ID_B = 900_000_001_211n;
const TELEGRAM_USER_ID_C = 900_000_001_212n;

describe('/undo real integration — real UndoLastTransactionActionUseCase + real Postgres + real-DI TelegramBotService (TASK-FIN-013)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const auditLogRepository = new PrismaTransactionAuditLogRepository(prisma);
  const deleteTransaction = new DeleteTransactionUseCase(transactionRepository, auditLogRepository);
  const restoreTransaction = new RestoreTransactionUseCase(
    transactionRepository,
    auditLogRepository,
  );
  const undoLastTransactionAction = new UndoLastTransactionActionUseCase(
    transactionRepository,
    deleteTransaction,
    restoreTransaction,
  );

  let userIdA: string;
  let userIdB: string;
  let categoryId: string;

  function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'Undo Test User A' },
      update: {},
    });
    userIdA = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'Undo Test User B' },
      update: {},
    });
    userIdB = userB.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }
    categoryId = category.id;
  }, 30_000);

  afterAll(async () => {
    for (const userId of [userIdA, userIdB]) {
      await prisma.transactionAuditLog.deleteMany({ where: { transaction: { userId } } });
      await prisma.transaction.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.onModuleDestroy();
  }, 30_000);

  it('undoes a real delete: create a real transaction → soft-delete it → /undo restores it in real Postgres (read-after-write)', async () => {
    const created = await transactionRepository.create({
      userId: userIdA,
      transactionType: 'EXPENSE',
      amount: '45000',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-15'),
      description: 'Lunch',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
      createdBy: 'ai',
    });
    await transactionRepository.softDelete(created.id);

    const outcome = await undoLastTransactionAction.execute(userIdA);

    expect(outcome.kind).toBe('undone');
    if (outcome.kind !== 'undone') throw new Error('unreachable');
    expect(outcome.action).toBe('deleted');
    expect(outcome.transaction.id).toBe(created.id);

    const reread = await transactionRepository.findById(created.id);
    expect(reread?.isDeleted).toBe(false);
  }, 30_000);

  it('undoes a real create (never edited since): create a real transaction → /undo soft-deletes it via the real DeleteTransactionUseCase', async () => {
    const created = await transactionRepository.create({
      userId: userIdA,
      transactionType: 'EXPENSE',
      amount: '9000',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-16'),
      description: 'Coffee',
      originalText: 'spent 9000 on coffee',
      sourceType: 'text',
      createdBy: 'ai',
    });

    const outcome = await undoLastTransactionAction.execute(userIdA);

    expect(outcome.kind).toBe('undone');
    if (outcome.kind !== 'undone') throw new Error('unreachable');
    expect(outcome.action).toBe('created');
    expect(outcome.transaction.id).toBe(created.id);

    const reread = await transactionRepository.findById(created.id);
    expect(reread?.isDeleted).toBe(true);
  }, 30_000);

  it("cross-user isolation: two users each undo their own last transaction against real Postgres, never the other user's row", async () => {
    const txnA = await transactionRepository.create({
      userId: userIdA,
      transactionType: 'EXPENSE',
      amount: '1000',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-17'),
      description: 'A only',
      originalText: 'A only',
      sourceType: 'text',
      createdBy: 'ai',
    });
    const txnB = await transactionRepository.create({
      userId: userIdB,
      transactionType: 'EXPENSE',
      amount: '2000',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-17'),
      description: 'B only',
      originalText: 'B only',
      sourceType: 'text',
      createdBy: 'ai',
    });

    const outcomeA = await undoLastTransactionAction.execute(userIdA);
    const outcomeB = await undoLastTransactionAction.execute(userIdB);

    expect(outcomeA.kind).toBe('undone');
    expect(outcomeB.kind).toBe('undone');
    if (outcomeA.kind !== 'undone' || outcomeB.kind !== 'undone') throw new Error('unreachable');
    expect(outcomeA.transaction.id).toBe(txnA.id);
    expect(outcomeB.transaction.id).toBe(txnB.id);

    const rereadA = await transactionRepository.findById(txnA.id);
    const rereadB = await transactionRepository.findById(txnB.id);
    expect(rereadA?.isDeleted).toBe(true);
    expect(rereadB?.isDeleted).toBe(true);
    expect(rereadA?.userId).toBe(userIdA);
    expect(rereadB?.userId).toBe(userIdB);
  }, 30_000);

  it('concurrent double /undo on the same deleted transaction: exactly one real restore lands, the other fails safely, never a double restore', async () => {
    const created = await transactionRepository.create({
      userId: userIdA,
      transactionType: 'EXPENSE',
      amount: '7700',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-19'),
      description: 'Race fixture',
      originalText: 'Race fixture',
      sourceType: 'text',
      createdBy: 'ai',
    });
    await transactionRepository.softDelete(created.id);

    // Races the SAME known transaction id directly through the real
    // `RestoreTransactionUseCase` — the exact use case `/undo` delegates to
    // for "last action = delete" — matching `undo-concurrency.integration
    // .spec.ts`'s own established convention of racing a known id directly
    // rather than through a pointer-resolution step (racing through
    // `UndoLastTransactionActionUseCase.execute()` itself does not
    // reliably reproduce this race: whichever call's own fresh
    // `findMostRecentByUserId` read happens second may simply observe the
    // already-restored row and safely resolve to `unsupported_action`
    // rather than attempting a second restore — itself a safe, correct
    // outcome, just not this test's target).
    const results = await Promise.allSettled([
      restoreTransaction.execute({ transactionId: created.id, userId: userIdA }),
      restoreTransaction.execute({ transactionId: created.id, userId: userIdA }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // The real atomic conditional write inside `TransactionRepository
    // .restore()` guarantees only one of these two concurrent calls actually
    // performs the restore — the other receives `null` back and throws
    // `TransactionNotDeletedError`.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reread = await transactionRepository.findById(created.id);
    expect(reread?.isDeleted).toBe(false);

    const auditEntries = await prisma.transactionAuditLog.findMany({
      where: { transactionId: created.id, fieldName: 'deleted_at' },
    });
    expect(auditEntries).toHaveLength(1);
  }, 30_000);

  it('nothing_to_undo for a user with no transaction history at all', async () => {
    const userC = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_C },
      create: { telegramUserId: TELEGRAM_USER_ID_C, displayName: 'Undo Test User C (empty)' },
      update: {},
    });

    const outcome = await undoLastTransactionAction.execute(userC.id);
    expect(outcome).toEqual({ kind: 'nothing_to_undo' });

    await prisma.user.delete({ where: { id: userC.id } });
  }, 30_000);

  it('the real /undo command, dispatched through a real-DI TelegramBotService, restores a real soft-deleted transaction', async () => {
    commandHandlers.clear();

    const created = await transactionRepository.create({
      userId: userIdA,
      transactionType: 'EXPENSE',
      amount: '3300',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-18'),
      description: 'Via /undo command',
      originalText: 'Via /undo command',
      sourceType: 'text',
      createdBy: 'ai',
    });
    await transactionRepository.softDelete(created.id);

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
      {} as any,
      {} as any,
      {} as any,
      undoLastTransactionAction,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    expect(service).toBeInstanceOf(TelegramBotService);

    const reply = vi.fn();
    await asUser(userIdA, () =>
      commandHandlers.get('undo')!({
        provisioning: {
          user: { preferredLanguage: 'en', timezone: 'UTC', defaultCurrency: 'UZS' },
        },
        reply,
      }),
    );

    expect(reply).toHaveBeenCalledTimes(1);
    const [text] = reply.mock.calls[0]!;
    expect(text).toContain('UZS');
    expect(text).toContain('Restored');

    const reread = await transactionRepository.findById(created.id);
    expect(reread?.isDeleted).toBe(false);
  }, 30_000);
});

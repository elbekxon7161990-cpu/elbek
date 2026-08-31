import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeleteTransactionUseCase } from '@afa/application';
import {
  PrismaService,
  PrismaTransactionAuditLogRepository,
  PrismaTransactionRepository,
} from '@afa/infrastructure';

/**
 * TASK-BOT-007-FIX — the real-Postgres, genuinely-concurrent test proving
 * `DeleteTransactionUseCase`'s TOCTOU gap (found by TASK-BOT-007's own
 * `undo-concurrency.integration.spec.ts`, reproduced in 1 of 5 real runs —
 * two concurrent callers both observing `isDeleted: false` via the
 * pre-check before either write landed, producing two `deleted_at` audit
 * log rows for one logical deletion) is closed.
 *
 * Root cause: `DeleteTransactionUseCase.execute()`'s `findById` -> check
 * `isDeleted` -> `softDelete` sequence was TOCTOU-unsafe — the check and the
 * write were two separate operations, so a genuine race could let both
 * concurrent calls pass the check before either write committed.
 *
 * Fix: `TransactionRepository.softDelete` (the port, `@afa/domain`) now
 * returns `Transaction | null`, and `PrismaTransactionRepository.softDelete`
 * (`@afa/infrastructure`) performs the write as a single atomic conditional
 * `UPDATE ... WHERE id = ? AND deleted_at IS NULL` (`prisma.transaction.
 * updateMany`, not the previous unconditional `update()`), returning `null`
 * when zero rows matched. `DeleteTransactionUseCase` now derives "was this
 * already deleted" from THAT return value, not from its own earlier read —
 * the pre-check remains only as a fast-path for NotFound/Unauthorized. No
 * new locking primitive, no schema migration, no version column: Postgres's
 * own row-level locking on the conditional `UPDATE` is the entire guarantee,
 * mirroring — at the SQL layer — the same compare-and-set shape `BR-CE-006`
 * already established for Redis.
 *
 * Constructed directly (real `PrismaService`, owner role, matching every
 * other `*.integration.spec.ts` in this codebase) — no `AppModule` boot, no
 * Redis/conversation-state involvement at all (this bug and its fix are
 * entirely within `DeleteTransactionUseCase`/`TransactionRepository`,
 * independent of the Conversation Engine's own CAS mechanism, which this fix
 * does not touch).
 */
const HAS_ENVIRONMENT_FOR_THIS_SUITE = Boolean(process.env.DATABASE_URL);

// See undo-concurrency.integration.spec.ts's own comment: Vitest evaluates
// this file's `describe` body even when `skipIf` will skip its tests, so
// `PrismaService`'s constructor must never receive `undefined`.
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID = 900_000_000_801n;

describe.skipIf(!HAS_ENVIRONMENT_FOR_THIS_SUITE)(
  'TASK-BOT-007-FIX — concurrent DeleteTransactionUseCase.execute() under real Postgres (audit-log-race closed)',
  () => {
    const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
    // TASK-DB-010 — owner-role client, no user context established here;
    // both constructor params can safely be the same client.
    const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
    const auditLogRepository = new PrismaTransactionAuditLogRepository(prisma);
    const deleteTransaction = new DeleteTransactionUseCase(
      transactionRepository,
      auditLogRepository,
    );

    let userId: string;
    let categoryId: string;

    beforeAll(async () => {
      await prisma.onModuleInit();
      const user = await prisma.user.upsert({
        where: { telegramUserId: TEST_TELEGRAM_USER_ID },
        create: {
          telegramUserId: TEST_TELEGRAM_USER_ID,
          displayName: 'BOT-007-FIX Delete Concurrency Test',
        },
        update: {},
      });
      userId = user.id;

      const category = await prisma.category.findFirst({
        where: { defaultType: 'expense', status: 'active' },
      });
      if (!category) {
        throw new Error(
          'No active expense category found — run `prisma db seed` before this suite.',
        );
      }
      categoryId = category.id;
    });

    afterAll(async () => {
      await prisma.transactionAuditLog.deleteMany({ where: { transaction: { userId } } });
      await prisma.transaction.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.onModuleDestroy();
    });

    /** Run 5 times (a fresh transaction each time), matching TASK-BOT-007's own multi-run discipline that first surfaced the race — the fix must hold under real, repeated network timing, not just once. */
    it.each([1, 2, 3, 4, 5])(
      'run #%i — exactly one caller deletes, exactly one audit entry, the loser fails safely, never a double reversal',
      async (runNumber) => {
        const transaction = await transactionRepository.create({
          userId,
          transactionType: 'EXPENSE',
          amount: '9000',
          currency: 'UZS',
          categoryId,
          transactionDate: new Date('2026-01-15'),
          description: `Concurrency fix verification run ${runNumber}`,
          originalText: 'concurrency fix verification',
          sourceType: 'text',
          createdBy: 'ai',
        });

        // The actual race: two calls to the real, production use case,
        // against the SAME real row, launched together via Promise.all.
        const results = await Promise.allSettled([
          deleteTransaction.execute({ transactionId: transaction.id, userId, actor: 'undo' }),
          deleteTransaction.execute({ transactionId: transaction.id, userId, actor: 'undo' }),
        ]);

        const succeeded = results.filter((r) => r.status === 'fulfilled');
        const failed = results.filter((r) => r.status === 'rejected');
        expect(succeeded).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect((failed[0] as PromiseRejectedResult).reason?.constructor?.name).toBe(
          'TransactionAlreadyDeletedError',
        );

        // --- Real Postgres: exactly one logical deletion end-state ---
        const finalTransaction = await transactionRepository.findById(transaction.id);
        expect(finalTransaction?.isDeleted).toBe(true);

        // --- Real Postgres: exactly one audit-log row — the race this fix closes ---
        const auditEntries = await prisma.transactionAuditLog.findMany({
          where: { transactionId: transaction.id, fieldName: 'deleted_at' },
        });
        expect(auditEntries).toHaveLength(1);

        // --- A third, now-genuinely-stale delete attempt is also safely rejected ---
        await expect(
          deleteTransaction.execute({ transactionId: transaction.id, userId, actor: 'undo' }),
        ).rejects.toThrow('already deleted');
        const auditEntriesAfterThirdAttempt = await prisma.transactionAuditLog.findMany({
          where: { transactionId: transaction.id, fieldName: 'deleted_at' },
        });
        expect(auditEntriesAfterThirdAttempt).toHaveLength(1); // still exactly one, never a third write
      },
      30_000,
    );
  },
);

describe('TASK-BOT-007-FIX — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only), read by CI/human operators to see why the suite above skipped.
    console.log('TASK-BOT-007-FIX environment gate:', JSON.stringify(status));

    expect(typeof HAS_ENVIRONMENT_FOR_THIS_SUITE).toBe('boolean');
  });
});

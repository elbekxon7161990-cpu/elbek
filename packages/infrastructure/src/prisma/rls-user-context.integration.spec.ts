import { MissingDatabaseUserContextError, runWithUserContext } from '@afa/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from './prisma.service';
import { createRlsContextExtension } from './rls-context.extension';

/**
 * TASK-DB-011 — real Row-Level Security enforcement tests. Unlike every
 * other `*.integration.spec.ts` in this package (which connects as
 * `afa_owner`, the table owner, and therefore silently bypasses RLS), this
 * file connects as `app_user` — the role the `tenant_isolation` policies
 * (packages/infrastructure/prisma/migrations/20260808000000_init/
 * migration.sql) are actually scoped to. That is the entire point of this
 * suite: it is the first thing in this repository that would actually
 * fail if RLS enforcement (or this task's context-propagation mechanism)
 * were broken.
 *
 * Precondition beyond `docker compose up -d postgres` + migrations + seed:
 * `app_user` needs a real password. The migration only runs
 * `CREATE ROLE app_user LOGIN;` with no password set — this is a
 * pre-existing gap this task discovered but does not fix (see
 * docs/rls-user-context.md's "Known gaps" section). Set
 * `RLS_TEST_DATABASE_URL` to a working `app_user` connection string once
 * that password exists; the fallback below will not authenticate as-is.
 */
const RLS_DATABASE_URL =
  process.env.RLS_TEST_DATABASE_URL ??
  'postgresql://app_user:CHANGE_ME@localhost:5432/afa?schema=public';

const TELEGRAM_USER_ID_A = 900_000_000_201n;
const TELEGRAM_USER_ID_B = 900_000_000_202n;

describe('RLS user-context — real PostgreSQL enforcement (integration)', () => {
  const basePrisma = new PrismaService({ datasources: { db: { url: RLS_DATABASE_URL } } });
  const rlsPrisma = basePrisma.$extends(createRlsContextExtension(basePrisma));
  let userAId: string;
  let userBId: string;
  let categoryId: string;

  beforeAll(async () => {
    await basePrisma.onModuleInit();

    // users/categories carry no RLS policy (rls-protected-models.ts) — safe
    // to seed via the base client directly, with no context required.
    const userA = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'RLS Test User A' },
      update: {},
    });
    userAId = userA.id;
    const userB = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'RLS Test User B' },
      update: {},
    });
    userBId = userB.id;

    const category = await basePrisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }
    categoryId = category.id;
  });

  afterAll(async () => {
    // TASK-MVP-002 — deletes each user's own transactions through the same
    // RLS-scoped path the tests themselves use, rather than
    // `basePrisma.transaction.deleteMany(...)` unscoped: `Transaction` is
    // RLS-protected, `basePrisma` connects as `app_user` (not `app_admin`/
    // BYPASSRLS), and an unscoped delete against an RLS-protected table on
    // a pooled connection with no `app.current_user_id` established for
    // *this specific call* is not a safe assumption to build cleanup on.
    await runWithUserContext(userAId, async () =>
      rlsPrisma.transaction.deleteMany({ where: { userId: userAId } }),
    );
    await runWithUserContext(userBId, async () =>
      rlsPrisma.transaction.deleteMany({ where: { userId: userBId } }),
    );
    await basePrisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await basePrisma.onModuleDestroy();
  });

  async function createTransactionAs(userId: string, description: string) {
    // TASK-MVP-002 — the callback must be `async` (or otherwise perform a
    // real `await`/`.then()` synchronously): a Prisma call like
    // `rlsPrisma.transaction.create(...)` returns a *lazy* `PrismaPromise`
    // that does not dispatch until something awaits it. A plain
    // non-`async` `() => rlsPrisma....create(...)` returns that lazy
    // promise straight through `runWithUserContext` without ever awaiting
    // it *inside* the callback, so its actual execution (and this
    // extension's `$allOperations` handler) runs after `AsyncLocalStorage`
    // has already exited the `.run()` scope — `requireCurrentUserId()`
    // then sees no context at all, deterministically, every time. Verified
    // both ways against a real database before this fix (see this task's
    // final report).
    return runWithUserContext(userId, async () =>
      rlsPrisma.transaction.create({
        data: {
          userId,
          transactionType: 'EXPENSE',
          amount: '1000',
          currency: 'UZS',
          categoryId,
          transactionDate: new Date('2026-01-15'),
          description,
          originalText: description,
          sourceType: 'manual',
          createdBy: 'user_manual',
        },
      }),
    );
  }

  it('1. User A sees their own transaction', async () => {
    const created = await createTransactionAs(userAId, 'A sees own');
    const found = await runWithUserContext(userAId, async () =>
      rlsPrisma.transaction.findUnique({ where: { id: created.id } }),
    );
    expect(found?.id).toBe(created.id);
  });

  it('2. User A cannot see User B’s transaction', async () => {
    const created = await createTransactionAs(userBId, 'B only');
    const found = await runWithUserContext(userAId, async () =>
      rlsPrisma.transaction.findUnique({ where: { id: created.id } }),
    );
    expect(found).toBeNull();
  });

  it('3. User B cannot see User A’s transaction (symmetric case)', async () => {
    const created = await createTransactionAs(userAId, 'A only');
    const found = await runWithUserContext(userBId, async () =>
      rlsPrisma.transaction.findUnique({ where: { id: created.id } }),
    );
    expect(found).toBeNull();
  });

  it('4. User A can insert a transaction owned by User A', async () => {
    const created = await createTransactionAs(userAId, 'A inserts own');
    expect(created.userId).toBe(userAId);
  });

  it('5. User A cannot insert a transaction claiming to belong to User B (RLS WITH CHECK)', async () => {
    await expect(
      runWithUserContext(userAId, async () =>
        rlsPrisma.transaction.create({
          data: {
            userId: userBId, // mismatched — context says A, row claims B
            transactionType: 'EXPENSE',
            amount: '1000',
            currency: 'UZS',
            categoryId,
            transactionDate: new Date('2026-01-15'),
            description: 'spoofed row',
            originalText: 'spoofed row',
            sourceType: 'manual',
            createdBy: 'user_manual',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('6. Missing ALS context fails before any SQL runs', async () => {
    // Deliberately not wrapped in runWithUserContext.
    await expect(rlsPrisma.transaction.findMany({ where: { userId: userAId } })).rejects.toThrow(
      MissingDatabaseUserContextError,
    );
  });

  it('7. Context disappears after transaction completion (no residue on connection reuse)', async () => {
    await createTransactionAs(userAId, 'sequential A');
    await createTransactionAs(userBId, 'sequential B');

    const asA = await runWithUserContext(userAId, async () =>
      rlsPrisma.transaction.findMany({ where: {} }),
    );
    expect(asA.every((t) => t.userId === userAId)).toBe(true);

    const asB = await runWithUserContext(userBId, async () =>
      rlsPrisma.transaction.findMany({ where: {} }),
    );
    expect(asB.every((t) => t.userId === userBId)).toBe(true);
  });

  it('8. Two concurrent requests for different users do not leak context', async () => {
    await createTransactionAs(userAId, 'concurrent A');
    await createTransactionAs(userBId, 'concurrent B');

    const [asA, asB] = await Promise.all([
      runWithUserContext(userAId, async () => rlsPrisma.transaction.findMany({ where: {} })),
      runWithUserContext(userBId, async () => rlsPrisma.transaction.findMany({ where: {} })),
    ]);

    expect(asA.every((t) => t.userId === userAId)).toBe(true);
    expect(asB.every((t) => t.userId === userBId)).toBe(true);
  });

  it('9. A rolled-back write leaves no stale context for the next transaction', async () => {
    await expect(
      runWithUserContext(userAId, async () =>
        rlsPrisma.transaction.create({
          data: {
            userId: userAId,
            transactionType: 'EXPENSE',
            amount: '-1', // violates the `amount > 0` CHECK constraint — forces a rollback
            currency: 'UZS',
            categoryId,
            transactionDate: new Date('2026-01-15'),
            description: 'forced rollback',
            originalText: 'forced rollback',
            sourceType: 'manual',
            createdBy: 'user_manual',
          },
        }),
      ),
    ).rejects.toThrow();

    // Immediately afterwards, as a different user, on whatever connection
    // the pool hands back — must see only that user's data.
    const asB = await runWithUserContext(userBId, async () =>
      rlsPrisma.transaction.findMany({ where: {} }),
    );
    expect(asB.every((t) => t.userId === userBId)).toBe(true);
  });

  it('10. A worker-job-shaped call (job.data.userId -> runWithUserContext -> handler) can read/write that user’s data', async () => {
    const jobData = { userId: userAId };
    const created = await runWithUserContext(jobData.userId, async () =>
      rlsPrisma.transaction.create({
        data: {
          userId: jobData.userId,
          transactionType: 'EXPENSE',
          amount: '2000',
          currency: 'UZS',
          categoryId,
          transactionDate: new Date('2026-01-15'),
          description: 'worker job',
          originalText: 'worker job',
          sourceType: 'api',
          createdBy: 'api',
        },
      }),
    );
    expect(created.userId).toBe(userAId);
  });

  it('11. A worker-job-shaped call with no user context cannot access tenant data', async () => {
    // Simulates a system-wide job that was never given an owning user —
    // it must not be able to silently read tenant data through the
    // RLS-scoped client; it must either fail (this path) or use a
    // separate app_admin/BYPASSRLS connection (not exercised here, and not
    // implemented by this task — see docs/rls-user-context.md).
    await expect(rlsPrisma.transaction.findMany({ where: {} })).rejects.toThrow(
      MissingDatabaseUserContextError,
    );
  });
});

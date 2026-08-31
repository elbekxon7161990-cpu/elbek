import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { runWithUserContext } from '@afa/shared';

import { PRISMA_BASE_CLIENT, PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaExportQueryRepository } from './prisma-export-query.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';

/**
 * TASK-FIN-014 (Chapter 10 §10.2, FR-EXP2-001/002/007) — real-Postgres proof
 * for `PrismaExportQueryRepository.getTransactionRows`. Mirrors
 * `../e2e/search-transactions-query.integration.spec.ts`'s own bootstrap
 * approach exactly (`Test.createTestingModule` + `ConfigModule.forRoot()` +
 * `PrismaModule`, `PRISMA_BASE_CLIENT` for owner-role fixture setup/
 * teardown, `PrismaService` for the RLS-scoped client production code
 * actually gets) — that file's own doc comment explains why a hand-rolled
 * `new PrismaService(...)` fails Postgres auth in this environment.
 */
const TELEGRAM_USER_ID_A = 900_000_001_080n;
const TELEGRAM_USER_ID_B = 900_000_001_081n;
const DEFAULT_CURRENCY = 'UZS';

describe('PrismaExportQueryRepository.getTransactionRows — TASK-FIN-014 (real Postgres)', () => {
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let transactionRepository: PrismaTransactionRepository;
  let exportQueryRepository: PrismaExportQueryRepository;

  let userIdA: string;
  let userIdB: string;
  let categoryId: string;
  let categoryCode: string;
  const createdTransactionIds: string[] = [];

  function asA<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userIdA, fn);
  }
  function asB<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userIdB, fn);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();
    basePrisma = moduleRef.get(PRISMA_BASE_CLIENT);
    prisma = moduleRef.get(PrismaService);
    await basePrisma.onModuleInit();
    transactionRepository = new PrismaTransactionRepository(prisma, basePrisma);
    exportQueryRepository = new PrismaExportQueryRepository(prisma);

    const userA = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'Export Test A', timezone: 'UTC' },
      update: { timezone: 'UTC', status: 'active' },
    });
    userIdA = userA.id;

    const userB = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'Export Test B', timezone: 'UTC' },
      update: { timezone: 'UTC', status: 'active' },
    });
    userIdB = userB.id;

    const category = await basePrisma.category.findFirst({
      where: { status: 'active', parentCategoryId: null },
    });
    if (!category) {
      throw new Error('Need at least 1 active top-level category — run `prisma db seed` first.');
    }
    categoryId = category.id;
    categoryCode = category.code;

    async function makeTxn(
      userId: string,
      overrides: Partial<{
        amount: string;
        currency: string;
        exchangeRateToDefault: string;
        merchant: string;
        paymentMethod: 'cash' | 'card' | 'bank_transfer' | 'mobile_wallet' | 'other';
        tags: string[];
        transactionDate: Date;
      }>,
    ) {
      const txn = await runWithUserContext(userId, () =>
        transactionRepository.create({
          userId,
          transactionType: 'EXPENSE',
          amount: overrides.amount ?? '10000.00',
          currency: overrides.currency ?? DEFAULT_CURRENCY,
          exchangeRateToDefault: overrides.exchangeRateToDefault,
          categoryId,
          merchant: overrides.merchant,
          paymentMethod: overrides.paymentMethod,
          transactionDate: overrides.transactionDate ?? new Date('2026-03-15'),
          description: 'export fixture',
          originalText: 'export fixture',
          sourceType: 'manual',
          createdBy: 'user_manual',
          tags: overrides.tags,
        }),
      );
      createdTransactionIds.push(txn.id);
      return txn;
    }

    await makeTxn(userIdA, {
      amount: '15000.00',
      merchant: 'Korzinka',
      paymentMethod: 'cash',
      tags: ['groceries', 'weekly'],
      transactionDate: new Date('2026-03-01'),
    });
    await makeTxn(userIdA, {
      amount: '100.00',
      currency: 'USD',
      exchangeRateToDefault: '12500.12345678',
      merchant: 'Foreign Store',
      paymentMethod: 'card',
      transactionDate: new Date('2026-03-10'),
    });
    await makeTxn(userIdB, {
      amount: '15000.00',
      merchant: 'Korzinka',
      transactionDate: new Date('2026-03-01'),
    });
  }, 30_000);

  afterAll(async () => {
    // `basePrisma` bypasses the RLS Prisma-extension's own require-a-context
    // guard, but the underlying Postgres RLS POLICY on `transactions` still
    // evaluates `current_setting('app.current_user_id')` regardless of
    // which Prisma client issued the query — a raw client session that
    // never had that GUC set fails with "invalid input syntax for type
    // uuid" (an empty default), not a permission error. A RAW DELETE ALSO
    // ONLY EVER AFFECTS ROWS OWNED BY WHICHEVER USER THE GUC IS CURRENTLY
    // SET TO — a single `set_config` call before a batched multi-user
    // delete silently deletes only that one user's rows, leaving every
    // OTHER user's fixture rows behind forever (this is the exact
    // pre-existing bug `search-transactions-query.integration.spec.ts`'s
    // own doc comment names as a known, out-of-scope cleanup problem;
    // diagnosed here to its true root cause while building this task's own
    // fixture, fixed here for THIS file only — that sibling file is
    // explicitly out of this task's scope, left untouched). Each user's
    // own rows must be deleted under THEIR OWN context, one user at a time.
    for (const userId of [userIdA, userIdB]) {
      await basePrisma
        .$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, false)`, userId)
        .catch(() => undefined);
      await basePrisma
        .$executeRawUnsafe(`DELETE FROM transactions WHERE user_id = $1::uuid`, userId)
        .catch(() => undefined);
    }
    await basePrisma
      .$executeRawUnsafe(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIdA, userIdB])
      .catch(() => undefined);
    await basePrisma.onModuleDestroy();
  });

  it('A — returns the full FR-EXP2-002 row shape, category resolved to its code (FR-EXP2-007), never a raw UUID', async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-03-01'), end: new Date('2026-03-02') },
        {},
        100,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: '15000.00',
      currency: 'UZS',
      categoryCode,
      merchant: 'Korzinka',
      paymentMethod: 'cash',
      tags: ['groceries', 'weekly'],
      description: 'export fixture',
      transactionType: 'EXPENSE',
    });
    expect(rows[0]!.categoryCode).not.toBe(categoryId);
  });

  it("B — computes convertedAmount from the transaction's own stored exchange-rate snapshot, never a fresh lookup", async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-03-10'), end: new Date('2026-03-11') },
        {},
        100,
      ),
    );

    expect(rows).toHaveLength(1);
    // 100.00 * 12500.12345678, rounded to 2 decimals.
    expect(rows[0]!.convertedAmount).toBe('1250012.35');
  });

  it('C — convertedAmount is null when no exchange-rate snapshot was recorded (never a fabricated 1:1 conversion)', async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-03-01'), end: new Date('2026-03-02') },
        {},
        100,
      ),
    );

    expect(rows[0]!.convertedAmount).toBeNull();
  });

  it('D — date-range filtering excludes rows outside the requested window', async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
        {},
        100,
      ),
    );
    expect(rows).toEqual([]);
  });

  it('E — categoryId filter narrows the result set', async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-01-01'), end: new Date('2026-12-31') },
        { categoryId },
        100,
      ),
    );
    expect(rows).toHaveLength(2);
  });

  it('F — the limit+1 cap-detection contract: requesting limit=1 with 2 real rows returns exactly 1 row (never more)', async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-01-01'), end: new Date('2026-12-31') },
        {},
        1,
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it("G — user ownership isolation: User A never sees User B's transactions, even with an identical merchant/amount", async () => {
    const resultA = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2026-01-01'), end: new Date('2026-12-31') },
        {},
        100,
      ),
    );
    const resultB = await asB(() =>
      exportQueryRepository.getTransactionRows(
        userIdB,
        { start: new Date('2026-01-01'), end: new Date('2026-12-31') },
        {},
        100,
      ),
    );

    expect(resultB).toHaveLength(1);
    const idsA = new Set(resultA.map((r) => r.id));
    for (const row of resultB) {
      expect(idsA.has(row.id)).toBe(false);
    }
  });

  it('H — returns an empty result set (never an error) when nothing matches', async () => {
    const rows = await asA(() =>
      exportQueryRepository.getTransactionRows(
        userIdA,
        { start: new Date('2020-01-01'), end: new Date('2020-02-01') },
        {},
        100,
      ),
    );
    expect(rows).toEqual([]);
  });
});

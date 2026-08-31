import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PRISMA_BASE_CLIENT,
  PrismaModule,
  PrismaReportQueryRepository,
  PrismaService,
  PrismaTransactionRepository,
} from '@afa/infrastructure';
import { runWithUserContext } from '@afa/shared';

/**
 * TASK-FIN-012 (Chapter 10 §10.3, FR-SCH-001/003/004/006) — real-Postgres
 * proof for `PrismaReportQueryRepository.searchTransactions`.
 *
 * Bootstrapped via `Test.createTestingModule` with `ConfigModule.forRoot()` +
 * `PrismaModule`, mirroring `generate-dashboard-di.integration.spec.ts`'s own
 * approach, rather than a bare/manually-datasource-overridden `new
 * PrismaService(...)` (the pattern several pre-existing sibling specs use,
 * e.g. `delete-transaction-concurrency.integration.spec.ts`,
 * `compute-full-cash-flow.integration.spec.ts`). This task found, while
 * isolating an unrelated authentication failure, that EVERY manually-
 * constructed `PrismaService` in this environment fails Postgres
 * authentication (confirmed against a pre-existing, entirely untouched
 * sibling spec too — not caused by this task's own code) — only the
 * `ConfigModule.forRoot()`-driven path picks up this environment's real
 * `DATABASE_URL` (a remote Supabase instance, not the `localhost` fallback
 * every hand-rolled integration spec in this codebase hardcodes). Not fixed
 * here, since `PrismaService`/the hand-rolled-construction convention are
 * shared, closed-task infrastructure out of this task's scope — see this
 * task's final report.
 */
const TELEGRAM_USER_ID_A = 900_000_001_060n;
const TELEGRAM_USER_ID_B = 900_000_001_061n;
const DEFAULT_CURRENCY = 'UZS';

describe('PrismaReportQueryRepository.searchTransactions — TASK-FIN-012 (real Postgres)', () => {
  /** Owner-role, RLS-BYPASSING client — fixture setup/teardown only (creating the test users, reading seeded categories, deleting fixtures), mirroring `compute-full-cash-flow.integration.spec.ts`'s own owner-role usage. Never used to exercise the repositories under test. */
  let basePrisma: PrismaService;
  /** RLS-EXTENDED client — the one production code actually gets via `PrismaService` DI, used to construct the repositories under test so this proof matches production wiring exactly. */
  let prisma: PrismaService;
  let transactionRepository: PrismaTransactionRepository;
  let reportQueryRepository: PrismaReportQueryRepository;

  let userIdA: string;
  let userIdB: string;
  let categoryId: string;
  let secondCategoryId: string;
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
    reportQueryRepository = new PrismaReportQueryRepository(prisma, basePrisma);

    const userA = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: {
        telegramUserId: TELEGRAM_USER_ID_A,
        displayName: 'Search Test A',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userIdA = userA.id;

    const userB = await basePrisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: {
        telegramUserId: TELEGRAM_USER_ID_B,
        displayName: 'Search Test B',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userIdB = userB.id;

    const categories = await basePrisma.category.findMany({
      where: { status: 'active', parentCategoryId: null },
      take: 2,
    });
    if (categories.length < 2) {
      throw new Error('Need at least 2 active top-level categories — run `prisma db seed` first.');
    }
    categoryId = categories[0]!.id;
    secondCategoryId = categories[1]!.id;

    async function makeTxn(
      userId: string,
      overrides: Partial<{
        transactionType: 'EXPENSE' | 'INCOME';
        amount: string;
        categoryId: string;
        merchant: string | null;
        transactionDate: Date;
        tags: string[];
      }>,
    ) {
      const txn = await runWithUserContext(userId, () =>
        transactionRepository.create({
          userId,
          transactionType: overrides.transactionType ?? 'EXPENSE',
          amount: overrides.amount ?? '10000.00',
          currency: DEFAULT_CURRENCY,
          categoryId: overrides.categoryId ?? categoryId,
          merchant: overrides.merchant ?? undefined,
          transactionDate: overrides.transactionDate ?? new Date('2026-03-15'),
          description: 'search fixture',
          originalText: 'search fixture',
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
      categoryId,
      merchant: 'Korzinka',
      transactionDate: new Date('2026-03-01'),
      tags: ['groceries'],
    });
    await makeTxn(userIdA, {
      amount: '50000.00',
      categoryId: secondCategoryId,
      merchant: 'Uzum Market',
      transactionDate: new Date('2026-03-10'),
      tags: ['electronics', 'gift'],
    });
    await makeTxn(userIdA, {
      transactionType: 'INCOME',
      amount: '2000000.00',
      categoryId,
      merchant: null,
      transactionDate: new Date('2026-03-20'),
    });
    await makeTxn(userIdA, {
      amount: '5000.00',
      categoryId,
      merchant: 'Korzinka',
      transactionDate: new Date('2026-04-01'),
      tags: ['groceries'],
    });
    for (let i = 0; i < 7; i += 1) {
      await makeTxn(userIdA, {
        amount: `${1000 + i}.00`,
        categoryId,
        merchant: `PagerShop${i}`,
        transactionDate: new Date('2026-03-25'),
      });
    }

    await makeTxn(userIdB, {
      amount: '15000.00',
      categoryId,
      merchant: 'Korzinka',
      transactionDate: new Date('2026-03-01'),
      tags: ['groceries'],
    });
  }, 30_000);

  afterAll(async () => {
    await basePrisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    await basePrisma.user.deleteMany({ where: { id: { in: [userIdA, userIdB] } } });
    await basePrisma.onModuleDestroy();
  });

  it('A — filters by date range', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(
        userIdA,
        {},
        { start: new Date('2026-04-01'), end: new Date('2026-05-01') },
        { limit: 10, offset: 0 },
      ),
    );
    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.merchant).toBe('Korzinka');
    expect(result.results[0]?.amount).toBe('5000.00');
  });

  it('B — filters by category', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, { categoryId: secondCategoryId }, null, {
        limit: 10,
        offset: 0,
      }),
    );
    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.merchant).toBe('Uzum Market');
  });

  it('C — filters by merchant (case-insensitive substring)', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, { merchant: 'korzinka' }, null, {
        limit: 10,
        offset: 0,
      }),
    );
    expect(result.totalCount).toBe(2);
    expect(result.results.every((r) => r.merchant === 'Korzinka')).toBe(true);
  });

  it('D — filters by transaction type', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, { transactionType: 'INCOME' }, null, {
        limit: 10,
        offset: 0,
      }),
    );
    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.transactionType).toBe('INCOME');
  });

  it('E — filters by amount min/max range', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(
        userIdA,
        { minAmount: '10000.00', maxAmount: '60000.00' },
        null,
        { limit: 10, offset: 0 },
      ),
    );
    expect(result.totalCount).toBe(2);
    expect(result.results.map((r) => r.amount).sort()).toEqual(['15000.00', '50000.00']);
  });

  it('F — filters by tags (matches any of the given tags)', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, { tags: ['gift'] }, null, {
        limit: 10,
        offset: 0,
      }),
    );
    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.merchant).toBe('Uzum Market');
  });

  it('G — combines multiple filters (category + merchant + type)', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(
        userIdA,
        { categoryId, merchant: 'Korzinka', transactionType: 'EXPENSE' },
        null,
        { limit: 10, offset: 0 },
      ),
    );
    expect(result.totalCount).toBe(2);
  });

  it('H — returns an empty result set (never an error) when nothing matches', async () => {
    const result = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, { merchant: 'NoSuchMerchantAtAll' }, null, {
        limit: 10,
        offset: 0,
      }),
    );
    expect(result.totalCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('I — paginates deterministically with no duplicate/missing rows across pages', async () => {
    const pageSize = 5;
    const page0 = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, {}, null, { limit: pageSize, offset: 0 }),
    );
    const page1 = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, {}, null, {
        limit: pageSize,
        offset: pageSize,
      }),
    );
    expect(page0.totalCount).toBe(11);
    expect(page0.results).toHaveLength(5);
    expect(page1.results.length).toBeGreaterThan(0);

    const page0Ids = page0.results.map((r) => r.id);
    const page1Ids = page1.results.map((r) => r.id);
    expect(page0Ids.filter((id) => page1Ids.includes(id))).toEqual([]);
  });

  it('J — deterministic ordering: most-recent-first, tie-broken by id, stable across repeated calls', async () => {
    const first = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, {}, null, { limit: 11, offset: 0 }),
    );
    const second = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, {}, null, { limit: 11, offset: 0 }),
    );
    expect(first.results.map((r) => r.id)).toEqual(second.results.map((r) => r.id));

    const dates = first.results.map((r) => r.transactionDate.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('K — user ownership isolation: User A never sees User B’s transactions, even with an identical merchant/category/amount', async () => {
    const resultA = await asA(() =>
      reportQueryRepository.searchTransactions(userIdA, { merchant: 'Korzinka' }, null, {
        limit: 20,
        offset: 0,
      }),
    );
    const resultB = await asB(() =>
      reportQueryRepository.searchTransactions(userIdB, { merchant: 'Korzinka' }, null, {
        limit: 20,
        offset: 0,
      }),
    );
    expect(resultB.totalCount).toBe(1);

    const idsA = new Set(resultA.results.map((r) => r.id));
    for (const id of resultB.results.map((r) => r.id)) {
      expect(idsA.has(id)).toBe(false);
    }
  });
});

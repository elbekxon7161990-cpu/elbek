import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { DispatchDomainEventsUseCase, GenerateReportUseCase } from '@afa/application';
import {
  computeMonthlyBoundary,
  computeQuarterlyBoundary,
  computeYearlyBoundary,
} from '@afa/domain';
import {
  buildTransactionEventCacheInvalidationConsumers,
  MapDomainEventConsumerRegistry,
  PrismaAccountRepository,
  PrismaBudgetRepository,
  PrismaDebtRepository,
  PrismaDomainEventRepository,
  PrismaReportQueryRepository,
  PrismaService,
  PrismaTransactionRepository,
  RedisReportCacheRepository,
  TransactionEventCacheInvalidationConsumer,
} from '@afa/infrastructure';

/**
 * TASK-REP-007 — the required real-Postgres + real-Redis proof of the full
 * read chain: report request → Redis GET → (miss) real SQL aggregation →
 * Redis SET → return; plus the write-side chain this task depends on and
 * does not modify (transaction mutation → domain_events → FR-DB-015
 * dispatcher → TASK-DB-009 consumer → cache invalidation) proven end to end
 * by actually invalidating a cache entry this suite itself populated.
 *
 * Deliberately placed in `apps/worker`, not `packages/infrastructure` — see
 * `transaction-event-cache-invalidation.integration.spec.ts`'s own doc
 * comment for why (that package never depends on `@afa/application`).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID_A = 900_000_000_910n;
const TEST_TELEGRAM_USER_ID_B = 900_000_000_911n;
const CURRENCY_CODE = 'UZS';

describe('TASK-REP-007 — Report Generation (real Postgres + real Redis)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const redis = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const reportQueryRepository = new PrismaReportQueryRepository(prisma, prisma);
  const cacheRepository = new RedisReportCacheRepository(redis);
  const debtRepository = new PrismaDebtRepository(prisma, prisma);
  const budgetRepository = new PrismaBudgetRepository(prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const domainEventRepository = new PrismaDomainEventRepository(prisma);
  const consumerHandler = new TransactionEventCacheInvalidationConsumer(cacheRepository);
  const registry = new MapDomainEventConsumerRegistry(
    buildTransactionEventCacheInvalidationConsumers(consumerHandler),
  );
  const dispatchUseCase = new DispatchDomainEventsUseCase(domainEventRepository, registry);
  const generateReport = new GenerateReportUseCase(
    reportQueryRepository,
    cacheRepository,
    debtRepository,
    budgetRepository,
  );

  let userIdA: string;
  let userIdB: string;
  let categoryId: string;
  let currentTestTransactionIds: string[] = [];
  let currentTestRedisKeys: string[] = [];
  let currentTestDebtIds: string[] = [];
  let currentTestBudgetIds: string[] = [];
  let currentTestAccountIds: string[] = [];
  let transferCategoryId: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    await redis.connect();

    // Same stray-row sweep as the TASK-DB-009 e2e suite — this shared dev
    // database can carry leftover `pending` domain_events from earlier
    // runs, and the dispatcher's claim is deliberately global.
    await prisma.domainEvent.deleteMany({
      where: { status: 'pending', createdAt: { lt: new Date() } },
    });

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID_A },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID_A, displayName: 'TASK-REP-007 User A' },
      update: {},
    });
    userIdA = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID_B },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID_B, displayName: 'TASK-REP-007 User B' },
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

    const transferCategory = await prisma.category.findFirst({ where: { code: 'TRANSFER' } });
    if (!transferCategory) {
      throw new Error(
        'No seeded TRANSFER category found — run `prisma db seed` before this suite.',
      );
    }
    transferCategoryId = transferCategory.id;
  }, 30_000);

  afterEach(async () => {
    if (currentTestTransactionIds.length > 0) {
      await prisma.domainEvent.deleteMany({
        where: {
          OR: [
            { payload: { path: ['userId'], equals: userIdA } },
            { payload: { path: ['userId'], equals: userIdB } },
          ],
        },
      });
      await prisma.transaction.deleteMany({ where: { id: { in: currentTestTransactionIds } } });
    }
    if (currentTestRedisKeys.length > 0) {
      await redis.del(...currentTestRedisKeys);
    }
    // Every report type this suite exercises writes under `report:{userId}:*`
    // — sweeping the whole pattern per user, per test, is simpler and more
    // robust than tracking every individual key a given test happens to
    // populate (some tests populate keys indirectly, via generateReport.*
    // rather than a direct redis.set call this file controls).
    const staleKeysA = await redis.keys(`report:${userIdA}:*`);
    const staleKeysB = await redis.keys(`report:${userIdB}:*`);
    if (staleKeysA.length + staleKeysB.length > 0) {
      await redis.del(...staleKeysA, ...staleKeysB);
    }
    if (currentTestDebtIds.length > 0) {
      await prisma.debtRepayment.deleteMany({ where: { debtId: { in: currentTestDebtIds } } });
      await prisma.debt.deleteMany({ where: { id: { in: currentTestDebtIds } } });
    }
    if (currentTestBudgetIds.length > 0) {
      await prisma.budgetNotificationLog.deleteMany({
        where: { budgetId: { in: currentTestBudgetIds } },
      });
      await prisma.budget.deleteMany({ where: { id: { in: currentTestBudgetIds } } });
    }
    if (currentTestAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: currentTestAccountIds } } });
    }
    currentTestTransactionIds = [];
    currentTestRedisKeys = [];
    currentTestDebtIds = [];
    currentTestBudgetIds = [];
    currentTestAccountIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    await prisma.debt.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    await prisma.budget.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userIdA, userIdB] } } });
    await redis.quit();
    await prisma.onModuleDestroy();
  });

  async function createExpense(
    userId: string,
    amount: string,
    transactionDate: Date,
    overrides: { merchant?: string; description?: string } = {},
  ): Promise<string> {
    const created = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount,
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate,
      description: overrides.description ?? 'TASK-REP-007 test expense',
      merchant: overrides.merchant,
      originalText: 'test expense',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);
    return created.id;
  }

  async function createIncome(
    userId: string,
    amount: string,
    transactionDate: Date,
  ): Promise<string> {
    const created = await transactionRepository.create({
      userId,
      transactionType: 'INCOME',
      amount,
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate,
      description: 'TASK-REP-001 test income',
      originalText: 'test income',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);
    return created.id;
  }

  async function createDebt(
    userId: string,
    direction: 'given' | 'received',
    amount: string,
    transactionDate: Date,
    dueDate: Date | null = null,
  ) {
    const debt = await debtRepository.create({
      userId,
      direction,
      counterpartyName: 'TASK-REP-001 Test Counterparty',
      counterpartyRefId: null,
      originalAmount: amount,
      currency: CURRENCY_CODE,
      transactionDate,
      dueDate,
      notes: null,
      originalText: `${direction} ${amount} ${CURRENCY_CODE}`,
    });
    currentTestDebtIds.push(debt.id);
    return debt;
  }

  async function settleDebtByFullRepayment(debtId: string, amount: string, repaymentDate: Date) {
    const result = await debtRepository.logRepayment({
      debtId,
      amount,
      currency: CURRENCY_CODE,
      repaymentDate,
      originalText: `repayment ${amount} ${CURRENCY_CODE}`,
    });
    if (!result) {
      throw new Error('logRepayment unexpectedly returned null in test setup.');
    }
    return result;
  }

  async function forgiveDebt(debtId: string, now: Date) {
    const result = await debtRepository.forgive(debtId, now);
    if (!result) {
      throw new Error('forgive unexpectedly returned null in test setup.');
    }
    return result;
  }

  async function createAccount(userId: string) {
    const account = await accountRepository.create({
      userId,
      name: 'TASK-REP-001 Test Account',
      accountType: 'other',
      currency: CURRENCY_CODE,
      startingBalance: '0.00',
      isDefault: false,
    });
    currentTestAccountIds.push(account.id);
    return account;
  }

  async function createTransfer(
    userId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: string,
    transactionDate: Date,
  ): Promise<string> {
    const created = await transactionRepository.create({
      userId,
      transactionType: 'TRANSFER',
      sourceAccountId,
      destinationAccountId,
      amount,
      currency: CURRENCY_CODE,
      categoryId: transferCategoryId,
      transactionDate,
      description: 'TASK-REP-001 test transfer',
      originalText: `transfer ${amount} ${CURRENCY_CODE}`,
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    currentTestTransactionIds.push(created.id);
    return created.id;
  }

  async function createOverallBudget(
    userId: string,
    limitAmount: string,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
  ) {
    const budget = await budgetRepository.create({
      userId,
      scopeType: 'overall',
      categoryId: null,
      limitAmount,
      currency: CURRENCY_CODE,
      periodType: 'monthly',
      currentPeriodStart,
      currentPeriodEnd,
    });
    currentTestBudgetIds.push(budget.id);
    return budget;
  }

  it('1a — Daily report: correct totals and category breakdown for a fixed known dataset', async () => {
    const asOf = new Date('2026-01-15T12:00:00Z');
    await createExpense(userIdA, '10000.00', new Date('2026-01-15'));
    await createExpense(userIdA, '5000.00', new Date('2026-01-15'));
    await createExpense(userIdA, '2000.00', new Date('2026-01-14')); // outside today's range

    const report = await generateReport.generateDaily(userIdA, asOf);

    expect(report.totalExpense).toBe('15000.00');
    expect(report.categoryBreakdown).toEqual([{ categoryId, totalAmount: '15000.00' }]);
  }, 30_000);

  it('1b — Custom Range report: correct totals for an arbitrary user-supplied range, and NEVER cached', async () => {
    await createExpense(userIdA, '30000.00', new Date('2026-03-05'));
    await createExpense(userIdA, '20000.00', new Date('2026-03-10'));
    const range = { start: new Date('2026-03-01'), end: new Date('2026-04-01') };

    const report = await generateReport.generateCustomRange(userIdA, range);

    expect(report.totalExpense).toBe('50000.00');
    // NFR-REP-002 — never cached: no key exists for any report_type/period_key combination this call could plausibly use.
    const keys = await redis.keys(`report:${userIdA}:*`);
    expect(keys).toHaveLength(0);
  }, 30_000);

  it('1c — Merchant report: total, frequency, and trend for a specific merchant only', async () => {
    await createExpense(userIdA, '25000.00', new Date('2026-04-01'), { merchant: 'Korzinka' });
    await createExpense(userIdA, '15000.00', new Date('2026-04-10'), { merchant: 'Korzinka' });
    await createExpense(userIdA, '99999.00', new Date('2026-04-10'), { merchant: 'Other Shop' });
    const range = { start: new Date('2026-04-01'), end: new Date('2026-05-01') };

    const report = await generateReport.generateMerchantReport(userIdA, 'Korzinka', range);

    expect(report.totalAmount).toBe('40000.00');
    expect(report.transactionCount).toBe(2);
  }, 30_000);

  it('1d — Category report: trend, merchant breakdown, and largest transactions scoped to one category', async () => {
    await createExpense(userIdA, '70000.00', new Date('2026-05-01'), { merchant: 'BigShop' });
    await createExpense(userIdA, '1000.00', new Date('2026-05-02'), { merchant: 'SmallShop' });
    const range = { start: new Date('2026-05-01'), end: new Date('2026-06-01') };

    const report = await generateReport.generateCategoryReport(userIdA, categoryId, range, 5);

    expect(report.largestTransactions[0]?.amount).toBe('70000.00');
    expect(report.merchantBreakdown.map((m) => m.merchant).sort()).toEqual([
      'BigShop',
      'SmallShop',
    ]);
  }, 30_000);

  it('2/3/4 — cache-then-SQL order: GET happens first, a miss computes via SQL and SETs under the exact report:{user_id}:{report_type}:{period_key} key, a subsequent request is a genuine cache HIT (poisoned value proves no recompute happened)', async () => {
    const asOf = new Date('2026-06-10T12:00:00Z');
    await createExpense(userIdA, '8000.00', new Date('2026-06-10'));

    const expectedKey = `report:${userIdA}:daily:2026-06-10`;
    expect(await redis.exists(expectedKey)).toBe(0);

    const firstReport = await generateReport.generateDaily(userIdA, asOf);
    expect(firstReport.totalExpense).toBe('8000.00');
    expect(await redis.exists(expectedKey)).toBe(1); // SET happened under the exact expected key

    // Poison the cache directly — if the next call hits SQL instead of the
    // cache, it would recompute the real ("8000.00") total, not this one.
    const poisoned = JSON.stringify({ totalExpense: 'POISONED', totalIncome: '0.00' });
    await redis.set(expectedKey, poisoned);

    const secondReport = await generateReport.generateDaily(userIdA, asOf);
    expect(secondReport.totalExpense).toBe('POISONED'); // proves this came from cache, not fresh SQL
  }, 30_000);

  it('5/6 — transaction create invalidates the relevant report cache, and the next request recomputes fresh data', async () => {
    const asOf = new Date('2026-07-20T12:00:00Z');
    const key = `report:${userIdA}:daily:2026-07-20`;

    // Pre-seed a stale cache entry, as if an earlier request had already cached today's report.
    await redis.set(key, JSON.stringify({ totalExpense: '1.00', totalIncome: '0.00' }));
    expect(await redis.exists(key)).toBe(1);

    // A real transaction mutation, through the real production create() path (TASK-DB-010's outbox).
    await createExpense(userIdA, '12345.00', new Date('2026-07-20'));

    // The real FR-DB-015 dispatcher, consuming the real TASK-DB-009 consumer.
    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');

    expect(await redis.exists(key)).toBe(0); // invalidated

    const report = await generateReport.generateDaily(userIdA, asOf);
    expect(report.totalExpense).toBe('12345.00'); // fresh, not the stale "1.00"
  }, 30_000);

  it('7 — historical period (two years ago): can be cached and is correctly invalidated/recomputed after a later edit', async () => {
    const historicalDate = new Date('2024-02-10');
    const asOfHistorical = new Date('2024-02-10T12:00:00Z');
    const transactionId = await createExpense(userIdA, '4000.00', historicalDate);
    await dispatchUseCase.dispatchOne(); // drain TransactionCommitted

    const firstReport = await generateReport.generateDaily(userIdA, asOfHistorical);
    expect(firstReport.totalExpense).toBe('4000.00');
    const key = `report:${userIdA}:daily:2024-02-10`;
    expect(await redis.exists(key)).toBe(1);

    await transactionRepository.update(transactionId, { amount: '9000.00' });
    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');
    expect(await redis.exists(key)).toBe(0);

    const secondReport = await generateReport.generateDaily(userIdA, asOfHistorical);
    expect(secondReport.totalExpense).toBe('9000.00');
  }, 30_000);

  it('8 — cross-user isolation: two real users with transactions in the same period see only their own totals and their own cache entries', async () => {
    // Deliberately well in the past (not "today" or close to it) — this
    // repository's own domain validation rejects a future-dated transaction
    // (see this task's final report, "discovered bugs" — a real, pre-existing
    // TASK-DB-010-era latent bug this suite avoids triggering, not fixes).
    const asOf = new Date('2026-06-20T12:00:00Z');
    await createExpense(userIdA, '11111.00', new Date('2026-06-20'));
    await createExpense(userIdB, '22222.00', new Date('2026-06-20'));

    const reportA = await generateReport.generateDaily(userIdA, asOf);
    const reportB = await generateReport.generateDaily(userIdB, asOf);

    expect(reportA.totalExpense).toBe('11111.00');
    expect(reportB.totalExpense).toBe('22222.00');

    const keyA = `report:${userIdA}:daily:2026-06-20`;
    const keyB = `report:${userIdB}:daily:2026-06-20`;
    expect(await redis.get(keyA)).toContain('11111.00');
    expect(await redis.get(keyB)).toContain('22222.00');
  }, 30_000);

  it('Quarterly and Yearly reports also compute correctly against real data (rounding out all 4 cached report types)', async () => {
    const asOf = new Date('2026-06-15T12:00:00Z');
    await createExpense(userIdA, '5000.00', new Date('2026-05-01')); // same quarter/year, different month
    await createExpense(userIdA, '3000.00', new Date('2026-06-15'));

    const quarterlyBoundary = computeQuarterlyBoundary(asOf);
    const yearlyBoundary = computeYearlyBoundary(asOf);
    expect(quarterlyBoundary.periodKey).toBe('2026-Q2');
    expect(yearlyBoundary.periodKey).toBe('2026');

    const quarterly = await generateReport.generateQuarterly(userIdA, asOf);
    const yearly = await generateReport.generateYearly(userIdA, asOf);

    const quarterlyMonthTotal = quarterly.monthlyTrend.reduce(
      (sum, bucket) => sum + Number(bucket.totalExpense),
      0,
    );
    expect(quarterlyMonthTotal).toBeCloseTo(8000, 2);
    expect(yearly.totalExpense).toBe('8000.00');
  }, 30_000);

  it('Trend Analysis composes live from existing primitives, with no cache entry of its own', async () => {
    await createExpense(userIdA, '1000.00', new Date('2026-01-05'));
    await createExpense(userIdA, '5000.00', new Date('2026-06-05'));
    const range = { start: new Date('2026-01-01'), end: new Date('2026-07-01') };

    const report = await generateReport.generateTrendAnalysis(userIdA, range);

    expect(report.monthlyTrend.length).toBeGreaterThan(0);
    const keys = await redis.keys(`report:${userIdA}:*`);
    expect(keys).toHaveLength(0);
  }, 30_000);

  // ── TASK-REP-001 (remaining scope) — Monthly Report ──────────────────

  it('Monthly — normal totals, saved, category breakdown, and top merchants for a fixed known dataset', async () => {
    const asOf = new Date('2025-09-15T12:00:00Z');
    await createIncome(userIdA, '50000.00', new Date('2025-09-05'));
    await createExpense(userIdA, '10000.00', new Date('2025-09-10'), { merchant: 'BigShop' });
    await createExpense(userIdA, '5000.00', new Date('2025-09-12'), { merchant: 'SmallShop' });
    await createExpense(userIdA, '2000.00', new Date('2025-08-31')); // outside September

    const report = await generateReport.generateMonthly(userIdA, asOf);

    expect(report.periodKey).toBe(computeMonthlyBoundary(asOf).periodKey);
    expect(report.periodKey).toBe('2025-09');
    expect(report.totalExpense).toBe('15000.00');
    expect(report.totalIncome).toBe('50000.00');
    expect(report.totalSaved).toBe('35000.00');
    expect(report.categoryBreakdown).toEqual([{ categoryId, totalAmount: '15000.00' }]);
    expect(report.topMerchants.map((m) => m.merchant)).toEqual(['BigShop', 'SmallShop']);
  }, 30_000);

  it('Monthly — budget performance summary reflects real budget utilization (FR-FIN-031, never reimplemented)', async () => {
    const periodStart = new Date('2025-09-01');
    const periodEnd = new Date('2025-10-01');
    const asOf = new Date('2025-09-20T12:00:00Z');
    await createOverallBudget(userIdA, '100000.00', periodStart, periodEnd);
    await createExpense(userIdA, '25000.00', new Date('2025-09-10'));

    const report = await generateReport.generateMonthly(userIdA, asOf);

    expect(report.budgetPerformance).toHaveLength(1);
    expect(report.budgetPerformance[0]?.usedAmount).toBe('25000.00');
    expect(report.budgetPerformance[0]?.utilizationPercent).toBeCloseTo(25, 5);
  }, 30_000);

  it('Monthly — prior-month comparison is populated, and the month boundary correctly excludes the prior month’s own transaction', async () => {
    const asOf = new Date('2025-10-15T12:00:00Z');
    await createExpense(userIdA, '8000.00', new Date('2025-09-20')); // prior month
    await createExpense(userIdA, '3000.00', new Date('2025-10-05')); // current month

    const report = await generateReport.generateMonthly(userIdA, asOf);

    expect(report.totalExpense).toBe('3000.00'); // September's 8000 never leaks in
    expect(report.priorMonthComparison?.totalExpense).toBe('8000.00');
  }, 30_000);

  it('Monthly — cache-then-SQL: a poisoned cache entry proves the second request is a genuine cache HIT', async () => {
    const asOf = new Date('2025-11-10T12:00:00Z');
    await createExpense(userIdA, '4000.00', new Date('2025-11-10'));
    const key = `report:${userIdA}:monthly:2025-11`;

    const firstReport = await generateReport.generateMonthly(userIdA, asOf);
    expect(firstReport.totalExpense).toBe('4000.00');
    expect(await redis.exists(key)).toBe(1);

    // A numeric (not string-literal) poison value — `generateMonthly` derives
    // `totalSaved` via `subtractDecimalAmounts` on top of the cached totals
    // (unlike Daily's own report, which returns `totalExpense` verbatim), so
    // the poison must itself be a valid decimal string to prove a genuine
    // cache HIT without also exercising that arithmetic's own error path.
    const poisoned = JSON.stringify({ totalExpense: '77777.00', totalIncome: '0.00' });
    await redis.set(key, poisoned);
    const secondReport = await generateReport.generateMonthly(userIdA, asOf);
    expect(secondReport.totalExpense).toBe('77777.00');
  }, 30_000);

  it('Monthly — a transaction commit invalidates the monthly cache entry and the next request recomputes fresh data', async () => {
    const asOf = new Date('2025-12-10T12:00:00Z');
    const key = `report:${userIdA}:monthly:2025-12`;
    await redis.set(key, JSON.stringify({ totalExpense: '1.00', totalIncome: '0.00' }));

    await createExpense(userIdA, '9999.00', new Date('2025-12-10'));
    const dispatchResult = await dispatchUseCase.dispatchOne();
    expect(dispatchResult?.outcome).toBe('dispatched');
    expect(await redis.exists(key)).toBe(0);

    const report = await generateReport.generateMonthly(userIdA, asOf);
    expect(report.totalExpense).toBe('9999.00');
  }, 30_000);

  // ── TASK-REP-001 (remaining scope) — Cash Flow Report ────────────────

  it('Cash Flow — income vs expense and net result for the requested period (standard mode)', async () => {
    await createIncome(userIdA, '1000000.00', new Date('2026-01-05'));
    await createExpense(userIdA, '300000.00', new Date('2026-01-10'));
    const range = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

    const report = await generateReport.generateCashFlow(userIdA, range, CURRENCY_CODE);

    expect(report.totalIncome).toBe('1000000.00');
    expect(report.totalExpense).toBe('300000.00');
    expect(report.netCashFlow).toBe('700000.00');
    expect(report.fullCashFlow).toBeNull(); // never silently defaulted (FR-CSF-002)
  }, 30_000);

  it('Cash Flow — standard mode excludes debt effects entirely (BR-REP-003); fullCashFlow:true includes debt AND same-currency-transfer terms (net zero for the transfer) via computeFullCashFlow', async () => {
    await createIncome(userIdA, '1000000.00', new Date('2026-02-05'));
    await createDebt(userIdA, 'given', '100000.00', new Date('2026-02-06'));
    const accountOne = await createAccount(userIdA);
    const accountTwo = await createAccount(userIdA);
    await createTransfer(userIdA, accountOne.id, accountTwo.id, '50000.00', new Date('2026-02-07'));
    const range = { start: new Date('2026-02-01'), end: new Date('2026-03-01') };

    const standard = await generateReport.generateCashFlow(userIdA, range, CURRENCY_CODE);
    expect(standard.netCashFlow).toBe('1000000.00'); // debt/transfer never touch net_cash_flow
    expect(standard.fullCashFlow).toBeNull();

    const full = await generateReport.generateCashFlow(userIdA, range, CURRENCY_CODE, {
      fullCashFlow: true,
    });
    // full = net_cash_flow (1,000,000) + debt given (-100,000) + same-currency transfer (0) = 900,000
    expect(full.fullCashFlow).toBe('900000.00');
    expect(full.netCashFlow).toBe('1000000.00'); // netCashFlow itself is unaffected by the toggle
  }, 30_000);

  it('Cash Flow — two different periods for the same user compute independently correct results', async () => {
    await createIncome(userIdA, '100000.00', new Date('2026-03-05'));
    await createIncome(userIdA, '200000.00', new Date('2026-04-05'));
    const marchRange = { start: new Date('2026-03-01'), end: new Date('2026-04-01') };
    const aprilRange = { start: new Date('2026-04-01'), end: new Date('2026-05-01') };

    const march = await generateReport.generateCashFlow(userIdA, marchRange, CURRENCY_CODE);
    const april = await generateReport.generateCashFlow(userIdA, aprilRange, CURRENCY_CODE);

    expect(march.netCashFlow).toBe('100000.00');
    expect(april.netCashFlow).toBe('200000.00');
  }, 30_000);

  it('Cash Flow — respects the period boundary: a transaction dated exactly at range.end (exclusive) is excluded', async () => {
    await createIncome(userIdA, '500.00', new Date('2026-05-01')); // exactly range.end
    await createIncome(userIdA, '700.00', new Date('2026-04-30')); // just inside
    const range = { start: new Date('2026-04-01'), end: new Date('2026-05-01') };

    const report = await generateReport.generateCashFlow(userIdA, range, CURRENCY_CODE);

    expect(report.netCashFlow).toBe('700.00');
  }, 30_000);

  it('Cash Flow — an empty period returns "0.00" for both totals and netCashFlow, never a throw', async () => {
    const range = { start: new Date('2026-06-01'), end: new Date('2026-07-01') };

    const report = await generateReport.generateCashFlow(userIdA, range, CURRENCY_CODE);

    expect(report.totalIncome).toBe('0.00');
    expect(report.totalExpense).toBe('0.00');
    expect(report.netCashFlow).toBe('0.00');
  }, 30_000);

  // ── TASK-REP-001 (remaining scope) — Debt Summary Report ─────────────

  it('Debt Summary — open debts given and received are correctly split by direction', async () => {
    await createDebt(userIdA, 'given', '50000.00', new Date('2027-07-01'));
    await createDebt(userIdA, 'received', '75000.00', new Date('2027-07-02'));

    const report = await generateReport.generateDebtSummary(userIdA, new Date('2027-07-15'));

    expect(report.openDebtsGiven).toHaveLength(1);
    expect(report.openDebtsGiven[0]?.originalAmount).toBe('50000.00');
    expect(report.openDebtsReceived).toHaveLength(1);
    expect(report.openDebtsReceived[0]?.originalAmount).toBe('75000.00');
  }, 30_000);

  it('Debt Summary — historical settled debts (both repaid and forgiven) appear, and never in the open lists', async () => {
    const repaidDebt = await createDebt(userIdA, 'given', '20000.00', new Date('2027-07-01'));
    await settleDebtByFullRepayment(repaidDebt.id, '20000.00', new Date('2027-07-10'));
    const forgivenDebt = await createDebt(userIdA, 'received', '30000.00', new Date('2027-07-01'));
    await forgiveDebt(forgivenDebt.id, new Date('2027-07-11'));

    const report = await generateReport.generateDebtSummary(userIdA, new Date('2027-07-15'));

    expect(report.settledDebts.map((d) => d.status).sort()).toEqual(['forgiven', 'repaid']);
    expect(report.openDebtsGiven).toHaveLength(0);
    expect(report.openDebtsReceived).toHaveLength(0);
  }, 30_000);

  it('Debt Summary — aging: overdueDays is the exact day count past dueDate, or null when not yet due', async () => {
    await createDebt(userIdA, 'given', '10000.00', new Date('2027-06-01'), new Date('2027-07-01'));
    await createDebt(userIdA, 'given', '20000.00', new Date('2027-06-01'), new Date('2027-08-01'));

    const report = await generateReport.generateDebtSummary(userIdA, new Date('2027-07-06'));

    const overdue = report.openDebtsGiven.find((d) => d.originalAmount === '10000.00');
    const notYetDue = report.openDebtsGiven.find((d) => d.originalAmount === '20000.00');
    expect(overdue?.overdueDays).toBe(5);
    expect(notYetDue?.overdueDays).toBeNull();
  }, 30_000);

  it('Debt Summary — zero debts at all returns empty arrays (zero-state), never a throw', async () => {
    const report = await generateReport.generateDebtSummary(userIdB, new Date('2027-07-15'));

    expect(report.openDebtsGiven).toEqual([]);
    expect(report.openDebtsReceived).toEqual([]);
    expect(report.settledDebts).toEqual([]);
  }, 30_000);

  it('Debt Summary — due date boundary: due exactly today is not yet overdue, due yesterday is overdue by exactly 1 day', async () => {
    const asOf = new Date('2027-07-20T12:00:00Z');
    await createDebt(userIdA, 'given', '1000.00', new Date('2027-06-01'), new Date('2027-07-20'));
    await createDebt(
      userIdA,
      'received',
      '2000.00',
      new Date('2027-06-01'),
      new Date('2027-07-19'),
    );

    const report = await generateReport.generateDebtSummary(userIdA, asOf);

    expect(report.openDebtsGiven[0]?.overdueDays).toBeNull();
    expect(report.openDebtsReceived[0]?.overdueDays).toBe(1);
  }, 30_000);
});

describe('TASK-REP-007 — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
    };
    // eslint-disable-next-line no-console -- deliberate, safe (presence booleans only).
    console.log('TASK-REP-007 environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

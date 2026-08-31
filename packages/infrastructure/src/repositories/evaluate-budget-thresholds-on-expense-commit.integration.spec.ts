import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { evaluateBudgetThresholdsOnExpenseCommit } from './evaluate-budget-thresholds-on-expense-commit';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-003 (Chapter 19 Scenario C, FR-BUD-005, FR-FIN-048) — real-Postgres
 * proof that `PrismaTransactionRepository.create()`'s synchronous
 * budget-threshold hook fires the correct `BudgetThresholdCrossed` events,
 * exactly once per threshold per period, distinguishing "crossing" from
 * "being above" (this task's own explicit, most-important correctness bar).
 * Owner-role connection, matching every real-Postgres suite in this package.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID = 900_000_000_972n;
const CURRENCY_CODE = 'RUB'; // Scenario C is Elena's RUB grocery budget.

// Each test below gets its OWN calendar month as its budget period window —
// utilization is aggregated by (userId, categoryId, period window) only,
// not by which budget "owns" a transaction, so two tests sharing the same
// user+category+period would see each other's expenses. Distinct months
// per test give full isolation regardless of afterEach cleanup timing,
// rather than relying solely on cleanup always completing first.
// All four periods are already-past calendar months relative to this
// session's real system clock — `Transaction.validateNew` rejects a
// future-dated transaction_date, so period months must stay in the past.
const SEQUENTIAL_PERIOD = { start: new Date('2026-08-01'), end: new Date('2026-08-31') };
const SINGLE_JUMP_PERIOD = { start: new Date('2026-05-01'), end: new Date('2026-05-31') };
const INCOME_NOOP_PERIOD = { start: new Date('2026-06-01'), end: new Date('2026-06-30') };
const DUAL_BUDGET_PERIOD = { start: new Date('2026-07-01'), end: new Date('2026-07-31') };

describe('evaluateBudgetThresholdsOnExpenseCommit (Chapter 19 Scenario C, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const budgetRepository = new PrismaBudgetRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  let userId: string;
  let categoryId: string;
  let secondCategoryId: string;
  let createdBudgetIds: string[] = [];
  let createdTransactionIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const user = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: { telegramUserId: TELEGRAM_USER_ID, displayName: 'Scenario C Test', timezone: 'UTC' },
      update: { timezone: 'UTC', status: 'active' },
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', parentCategoryId: null },
    });
    if (!category) {
      throw new Error('No active top-level expense category found — run `prisma db seed` first.');
    }
    categoryId = category.id;

    const secondCategory = await prisma.category.findFirst({
      where: {
        defaultType: 'expense',
        status: 'active',
        parentCategoryId: null,
        id: { not: categoryId },
      },
    });
    if (!secondCategory) {
      throw new Error(
        'Need a SECOND active top-level expense category — run `prisma db seed` first.',
      );
    }
    secondCategoryId = secondCategory.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    createdTransactionIds = [];
    if (createdBudgetIds.length > 0) {
      for (const budgetId of createdBudgetIds) {
        await prisma.domainEvent.deleteMany({
          where: { payload: { path: ['budgetId'], equals: budgetId } },
        });
      }
      await prisma.budgetNotificationLog.deleteMany({
        where: { budgetId: { in: createdBudgetIds } },
      });
      await prisma.budget.deleteMany({ where: { id: { in: createdBudgetIds } } });
    }
    createdBudgetIds = [];
  });

  afterAll(async () => {
    // Defense-in-depth beyond afterEach — a test that fails mid-way (a
    // timeout, an unexpected throw) can leave its own createdTransactionIds/
    // createdBudgetIds arrays incomplete, orphaning rows afterEach never
    // saw. Sweeping by userId directly here guarantees a clean teardown
    // regardless of any individual test's own failure mode.
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.budgetNotificationLog.deleteMany({ where: { budget: { userId } } });
    await prisma.domainEvent.deleteMany({
      where: { payload: { path: ['userId'], equals: userId } },
    });
    await prisma.budget.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function budgetThresholdEvents(budgetId: string) {
    return prisma.domainEvent.findMany({
      where: {
        eventType: 'BudgetThresholdCrossed',
        payload: { path: ['budgetId'], equals: budgetId },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function spendExpense(
    amount: string,
    transactionDate: Date,
    overrides: Partial<{ categoryId: string; currency: string }> = {},
  ) {
    const transaction = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        amount,
        currency: overrides.currency ?? CURRENCY_CODE,
        categoryId: overrides.categoryId ?? categoryId,
        transactionDate,
        description: 'groceries',
        originalText: `spent ${amount} on groceries ${Math.random()}`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  it('Scenario C — a 900,000 RUB Groceries budget: sequential expenses crossing 75%, then 90%, then 100%, produce exactly one event per threshold, never a duplicate for staying above one', async () => {
    const txDate = new Date('2026-08-10');
    const budget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '900000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: SEQUENTIAL_PERIOD.start,
        currentPeriodEnd: SEQUENTIAL_PERIOD.end,
      }),
    );
    createdBudgetIds.push(budget.id);

    // 0% -> 80%: crosses 75%.
    await spendExpense('720000', txDate);
    let events = await budgetThresholdEvents(budget.id);
    expect(events.map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent)).toEqual(
      [75],
    );

    // 80% -> 82%: still above 75%, has NOT crossed 90% -> no new event
    // ("a transaction that leaves utilization above 90% without crossing it
    // must not generate another threshold notification" — the exact
    // distinction this task's own instructions singled out).
    await spendExpense('18000', txDate);
    events = await budgetThresholdEvents(budget.id);
    expect(events).toHaveLength(1);

    // 82% -> 96%: crosses 90%.
    await spendExpense('126000', txDate);
    events = await budgetThresholdEvents(budget.id);
    expect(events.map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent)).toEqual(
      [75, 90],
    );

    // 96% -> 104%: crosses 100%.
    await spendExpense('72000', txDate);
    events = await budgetThresholdEvents(budget.id);
    expect(events.map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent)).toEqual(
      [75, 90, 100],
    );

    // 104% -> 140%: already over 100% — "any subsequent overage in the same
    // period is a single follow-up, not repeated spam" (FR-BUD-005) — no
    // fourth event.
    await spendExpense('324000', txDate);
    events = await budgetThresholdEvents(budget.id);
    expect(events).toHaveLength(3);

    // Exactly one BudgetNotificationLog row per threshold (the actual dedup
    // mechanism this task was required to use, not the generic notification
    // dedup table).
    const logRows = await prisma.budgetNotificationLog.findMany({ where: { budgetId: budget.id } });
    expect(logRows.map((r) => r.thresholdFired).sort((a, b) => a - b)).toEqual([75, 90, 100]);
  }, 30000);

  it('a transaction landing far past 100% in a single jump crosses 75%, 90%, AND 100% simultaneously — three events from one transaction', async () => {
    const txDate = new Date('2026-05-10');
    const budget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '100000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: SINGLE_JUMP_PERIOD.start,
        currentPeriodEnd: SINGLE_JUMP_PERIOD.end,
      }),
    );
    createdBudgetIds.push(budget.id);

    await spendExpense('130000', txDate); // 0% -> 130%
    const events = await budgetThresholdEvents(budget.id);
    expect(events.map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent)).toEqual(
      [75, 90, 100],
    );
  }, 15000);

  it('BR-BUD-001 — a non-EXPENSE transaction (INCOME) never triggers a threshold check, even against an existing near-limit budget', async () => {
    const txDate = new Date('2026-06-10');
    const budget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '100000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: INCOME_NOOP_PERIOD.start,
        currentPeriodEnd: INCOME_NOOP_PERIOD.end,
      }),
    );
    createdBudgetIds.push(budget.id);
    await spendExpense('90000', txDate); // 90% — already crossed both 75% and 90%.
    const eventsAfterExpense = await budgetThresholdEvents(budget.id);
    expect(eventsAfterExpense).toHaveLength(2);

    const income = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'INCOME',
        amount: '5000000',
        currency: CURRENCY_CODE,
        categoryId,
        transactionDate: txDate,
        description: 'salary',
        originalText: 'received salary',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(income.id);

    const eventsAfterIncome = await budgetThresholdEvents(budget.id);
    expect(eventsAfterIncome).toHaveLength(2); // unchanged
  }, 15000);

  it('FR-BUD-008 — a single EXPENSE simultaneously updates BOTH its category budget and an overall budget, each producing its own independent threshold event', async () => {
    const txDate = new Date('2026-07-10');
    const categoryBudget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '100000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: DUAL_BUDGET_PERIOD.start,
        currentPeriodEnd: DUAL_BUDGET_PERIOD.end,
      }),
    );
    createdBudgetIds.push(categoryBudget.id);
    const overallBudget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'overall',
        categoryId: null,
        limitAmount: '200000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: DUAL_BUDGET_PERIOD.start,
        currentPeriodEnd: DUAL_BUDGET_PERIOD.end,
      }),
    );
    createdBudgetIds.push(overallBudget.id);

    await spendExpense('80000', txDate); // category: 80% (crosses 75%); overall: 40% (crosses nothing)
    expect(await budgetThresholdEvents(categoryBudget.id)).toHaveLength(1);
    expect(await budgetThresholdEvents(overallBudget.id)).toHaveLength(0);

    // category: total 80000+120000=200000, 80% -> 200% in one jump — only
    // 75% had fired before this expense, so THIS expense crosses both 90%
    // and 100% for the first time (2 new events, 3 total for the period).
    // overall: total 200000/200000 = 100%, crossing 75/90/100 all at once
    // (3 events, its first ones).
    await spendExpense('120000', txDate);
    const categoryEvents = await budgetThresholdEvents(categoryBudget.id);
    expect(
      categoryEvents.map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent),
    ).toEqual([75, 90, 100]);
    const overallEvents = await budgetThresholdEvents(overallBudget.id);
    expect(
      overallEvents.map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent),
    ).toEqual([75, 90, 100]);
  }, 15000);

  it("BudgetNotificationLog's own (budgetId, thresholdFired, periodStart) unique constraint rejects a direct duplicate insert (the real dedup guarantee, verified independently of the hook's own catch logic)", async () => {
    const budget = await as(() =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId,
        limitAmount: '100000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: SEQUENTIAL_PERIOD.start,
        currentPeriodEnd: SEQUENTIAL_PERIOD.end,
      }),
    );
    createdBudgetIds.push(budget.id);

    await prisma.budgetNotificationLog.create({
      data: { budgetId: budget.id, thresholdFired: 90, periodStart: SEQUENTIAL_PERIOD.start },
    });

    await expect(
      prisma.budgetNotificationLog.create({
        data: { budgetId: budget.id, thresholdFired: 90, periodStart: SEQUENTIAL_PERIOD.start },
      }),
    ).rejects.toThrow();
  });

  describe('TASK-FIN-003 — concurrency hardening (FOR NO KEY UPDATE, deterministic lock order)', () => {
    const CONCURRENCY_70_90_PERIOD = { start: new Date('2024-01-01'), end: new Date('2024-01-31') };
    const CONCURRENCY_80_100_PERIOD = {
      start: new Date('2024-02-01'),
      end: new Date('2024-02-28'),
    };
    const SOFT_DELETED_PERIOD = { start: new Date('2024-03-01'), end: new Date('2024-03-31') };
    const INACTIVE_PERIOD = { start: new Date('2024-04-01'), end: new Date('2024-04-30') };
    const OUTSIDE_WINDOW_PERIOD = { start: new Date('2024-05-01'), end: new Date('2024-05-31') };
    const ROLLBACK_PERIOD = { start: new Date('2024-06-01'), end: new Date('2024-06-30') };
    const INDEPENDENT_BUDGETS_PERIOD = {
      start: new Date('2024-07-01'),
      end: new Date('2024-07-31'),
    };
    const FX_MISSING_RATE_PERIOD = { start: new Date('2024-08-01'), end: new Date('2024-08-31') };

    it('CONCURRENCY — initial 70%, two genuinely concurrent +10% expenses (combined 90%): 75% fires exactly once, 90% fires exactly once (previously lost)', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '1000000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: CONCURRENCY_70_90_PERIOD.start,
          currentPeriodEnd: CONCURRENCY_70_90_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      // 0% -> 70%: crosses nothing (below 75).
      await spendExpense('700000', CONCURRENCY_70_90_PERIOD.start);
      expect(await budgetThresholdEvents(budget.id)).toHaveLength(0);

      // Two genuinely concurrent +10% expenses. Individually each is
      // 70%->80% (crosses 75% alone); combined they reach 90%, which
      // NEITHER commit's own isolated before/after view spans unless the
      // SUM is computed after a lock serializes them.
      const [first, second] = await Promise.all([
        spendExpense('100000', CONCURRENCY_70_90_PERIOD.start),
        spendExpense('100000', CONCURRENCY_70_90_PERIOD.start),
      ]);
      expect(first.id).toBeTruthy();
      expect(second.id).toBeTruthy();

      const events = await budgetThresholdEvents(budget.id);
      const thresholds = events
        .map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent)
        .sort((a, b) => a - b);
      expect(thresholds).toEqual([75, 90]);

      const finalUtilization = await as(() =>
        budgetRepository.computeUtilization(budget.id, userId, CONCURRENCY_70_90_PERIOD.start),
      );
      expect(finalUtilization?.usedAmount).toBe('900000.00');
    }, 30_000);

    it('CONCURRENCY — initial 80%, two genuinely concurrent +10% expenses (combined 100%): 90% fires exactly once, 100% fires exactly once (previously lost)', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '1000000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: CONCURRENCY_80_100_PERIOD.start,
          currentPeriodEnd: CONCURRENCY_80_100_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      // 0% -> 80%: crosses 75% (1 event, not this test's own subject).
      await spendExpense('800000', CONCURRENCY_80_100_PERIOD.start);
      expect(await budgetThresholdEvents(budget.id)).toHaveLength(1);

      const [first, second] = await Promise.all([
        spendExpense('100000', CONCURRENCY_80_100_PERIOD.start),
        spendExpense('100000', CONCURRENCY_80_100_PERIOD.start),
      ]);
      expect(first.id).toBeTruthy();
      expect(second.id).toBeTruthy();

      const events = await budgetThresholdEvents(budget.id);
      const thresholds = events
        .map((e) => (e.payload as { thresholdPercent: number }).thresholdPercent)
        .sort((a, b) => a - b);
      expect(thresholds).toEqual([75, 90, 100]);

      const finalUtilization = await as(() =>
        budgetRepository.computeUtilization(budget.id, userId, CONCURRENCY_80_100_PERIOD.start),
      );
      expect(finalUtilization?.usedAmount).toBe('1000000.00');
    }, 30_000);

    it('MULTI-BUDGET DEADLOCK — two concurrent expenses, each touching the SAME category budget AND the SAME overall budget, in 10 independent runs: zero deadlocks, zero lost thresholds, zero duplicate thresholds', async () => {
      for (let i = 0; i < 10; i += 1) {
        const period = { start: new Date(2025, i, 1), end: new Date(2025, i + 1, 0) };
        const categoryBudget = await as(() =>
          budgetRepository.create({
            userId,
            scopeType: 'category',
            categoryId,
            limitAmount: '1000000',
            currency: CURRENCY_CODE,
            periodType: 'monthly',
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
          }),
        );
        createdBudgetIds.push(categoryBudget.id);
        const overallBudget = await as(() =>
          budgetRepository.create({
            userId,
            scopeType: 'overall',
            categoryId: null,
            limitAmount: '2000000',
            currency: CURRENCY_CODE,
            periodType: 'monthly',
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
          }),
        );
        createdBudgetIds.push(overallBudget.id);

        // Both expenses match BOTH budgets' candidate set (same category,
        // same period) — exactly the shape that needs deterministic lock
        // ordering to avoid a cross-budget deadlock between two concurrent
        // transactions each locking the same two rows.
        const results = await Promise.allSettled([
          spendExpense('400000', period.start),
          spendExpense('400000', period.start),
        ]);

        for (const result of results) {
          expect(result.status).toBe('fulfilled');
        }

        // category: 0 -> 800000/1000000 = 80% -> crosses 75% exactly once.
        const categoryEvents = await budgetThresholdEvents(categoryBudget.id);
        const categoryThresholds = categoryEvents.map(
          (e) => (e.payload as { thresholdPercent: number }).thresholdPercent,
        );
        expect(categoryThresholds).toEqual([75]);

        // overall: 0 -> 800000/2000000 = 40% -> crosses nothing.
        const overallEvents = await budgetThresholdEvents(overallBudget.id);
        expect(overallEvents).toHaveLength(0);

        const logRows = await prisma.budgetNotificationLog.findMany({
          where: { budgetId: categoryBudget.id },
        });
        expect(logRows).toHaveLength(1); // never duplicated across the two concurrent commits

        // uq_budgets_category_period / uq_budgets_overall_period are scoped
        // to (user_id, category_id|—, period_type) WHERE deleted_at IS NULL
        // — NOT to the period's own date range — so a second category (or
        // overall) budget for this same user+period_type would collide with
        // this iteration's budgets even though they cover a different
        // calendar month. Soft-delete both before the next iteration
        // creates its own, freeing the unique-index slot exactly the way a
        // real user replacing a budget would.
        await as(() => budgetRepository.softDelete(categoryBudget.id, userId));
        await as(() => budgetRepository.softDelete(overallBudget.id, userId));
      }
    }, 120_000);

    it('a soft-deleted budget is excluded even if the lock-acquisition-time re-check is what catches it (concurrently deleted between discovery and lock)', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: SOFT_DELETED_PERIOD.start,
          currentPeriodEnd: SOFT_DELETED_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      await as(() => budgetRepository.softDelete(budget.id, userId));

      // Would cross 75%/90% if the budget were still active.
      await spendExpense('90000', SOFT_DELETED_PERIOD.start);
      expect(await budgetThresholdEvents(budget.id)).toHaveLength(0);
    }, 15_000);

    it('a paused budget is excluded from threshold evaluation', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: INACTIVE_PERIOD.start,
          currentPeriodEnd: INACTIVE_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      // No use case ever sets 'paused' (disclosed gap, out of this fix's
      // scope) — set directly to prove the hook itself correctly excludes
      // a non-'active' budget regardless of how it got that way.
      await prisma.budget.update({ where: { id: budget.id }, data: { status: 'paused' } });

      await spendExpense('90000', INACTIVE_PERIOD.start);
      expect(await budgetThresholdEvents(budget.id)).toHaveLength(0);
    }, 15_000);

    it('an expense dated outside the budget’s current period window never triggers that budget’s threshold check', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: OUTSIDE_WINDOW_PERIOD.start,
          currentPeriodEnd: OUTSIDE_WINDOW_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      const beforeWindow = new Date(
        OUTSIDE_WINDOW_PERIOD.start.getFullYear(),
        OUTSIDE_WINDOW_PERIOD.start.getMonth() - 1,
        15,
      );
      await spendExpense('90000', beforeWindow);
      expect(await budgetThresholdEvents(budget.id)).toHaveLength(0);
    }, 15_000);

    it('ROLLBACK — a forced failure after the threshold hook has queued BudgetNotificationLog + BudgetThresholdCrossed rolls back BOTH writes together', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: ROLLBACK_PERIOD.start,
          currentPeriodEnd: ROLLBACK_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      const forcedError = new Error('FORCED_ROLLBACK_TEST_MARKER');
      const originalText = `forced-rollback-${Date.now()}`;

      await expect(
        as(() =>
          prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
            const txnRow = await tx.transaction.create({
              data: {
                userId,
                transactionType: 'EXPENSE',
                amount: '90000',
                currency: CURRENCY_CODE,
                categoryId,
                transactionDate: ROLLBACK_PERIOD.start,
                description: 'forced rollback',
                originalText,
                sourceType: 'manual',
                createdBy: 'user_manual',
                tags: [],
                isRecurringDetected: false,
              },
            });
            await evaluateBudgetThresholdsOnExpenseCommit(tx, {
              transactionId: txnRow.id,
              userId,
              categoryId,
              subcategoryId: null,
              transactionDate: ROLLBACK_PERIOD.start,
            });
            throw forcedError; // forces the whole transaction to roll back
          }),
        ),
      ).rejects.toThrow('FORCED_ROLLBACK_TEST_MARKER');

      const orphanedRows = await prisma.transaction.findMany({ where: { originalText } });
      expect(orphanedRows).toHaveLength(0);

      expect(await budgetThresholdEvents(budget.id)).toHaveLength(0);
      const logRows = await prisma.budgetNotificationLog.findMany({
        where: { budgetId: budget.id },
      });
      expect(logRows).toHaveLength(0);

      const finalUtilization = await as(() =>
        budgetRepository.computeUtilization(budget.id, userId, ROLLBACK_PERIOD.start),
      );
      expect(finalUtilization?.usedAmount).toBe('0.00');
    }, 15_000);

    it('two concurrent expenses against DIFFERENT, unrelated budgets never contend with each other and each correctly fires its own events', async () => {
      const budgetA = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: INDEPENDENT_BUDGETS_PERIOD.start,
          currentPeriodEnd: INDEPENDENT_BUDGETS_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budgetA.id);
      const budgetB = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId: secondCategoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: INDEPENDENT_BUDGETS_PERIOD.start,
          currentPeriodEnd: INDEPENDENT_BUDGETS_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budgetB.id);

      const [resultA, resultB] = await Promise.all([
        spendExpense('80000', INDEPENDENT_BUDGETS_PERIOD.start, { categoryId }),
        spendExpense('80000', INDEPENDENT_BUDGETS_PERIOD.start, { categoryId: secondCategoryId }),
      ]);
      expect(resultA.id).toBeTruthy();
      expect(resultB.id).toBeTruthy();

      expect(
        (await budgetThresholdEvents(budgetA.id)).map(
          (e) => (e.payload as { thresholdPercent: number }).thresholdPercent,
        ),
      ).toEqual([75]);
      expect(
        (await budgetThresholdEvents(budgetB.id)).map(
          (e) => (e.payload as { thresholdPercent: number }).thresholdPercent,
        ),
      ).toEqual([75]);
    }, 15_000);

    it('existing FX behavior is unchanged by this fix: a missing fx_rates row still makes a cross-currency expense contribute 0 rather than throwing (disclosed limitation, not FR-FIN-043 compliant, by design)', async () => {
      const budget = await as(() =>
        budgetRepository.create({
          userId,
          scopeType: 'category',
          categoryId,
          limitAmount: '100000',
          currency: CURRENCY_CODE, // RUB
          periodType: 'monthly',
          currentPeriodStart: FX_MISSING_RATE_PERIOD.start,
          currentPeriodEnd: FX_MISSING_RATE_PERIOD.end,
        }),
      );
      createdBudgetIds.push(budget.id);

      // USD expense against a RUB budget — no fx_rates row seeded anywhere
      // in this environment (a pre-existing, disclosed condition, not
      // something this fix created or touched).
      await spendExpense('90000', FX_MISSING_RATE_PERIOD.start, { currency: 'USD' });

      expect(await budgetThresholdEvents(budget.id)).toHaveLength(0);
      const finalUtilization = await as(() =>
        budgetRepository.computeUtilization(budget.id, userId, FX_MISSING_RATE_PERIOD.start),
      );
      expect(finalUtilization?.usedAmount).toBe('0.00');
    }, 15_000);
  });
});

describe('evaluateBudgetThresholdsOnExpenseCommit — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('Scenario C threshold-hook environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

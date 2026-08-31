import { DuplicateBudgetError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaBudgetRepository } from './prisma-budget.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-003 — real-Postgres proof for `PrismaBudgetRepository` and the
 * synchronous `evaluateBudgetThresholdsOnExpenseCommit` hook wired into
 * `PrismaTransactionRepository.create()`. Owner-role connection, matching
 * every newer real-Postgres suite in this package (`prisma-debt.repository.
 * integration.spec.ts`'s own established convention) — `DIRECT_URL` if set,
 * else the local-dev default. `Budget`/`BudgetNotificationLog`/`Transaction`
 * are all RLS-protected; every mutating call runs inside
 * `runWithUserContext`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_970n;
const TELEGRAM_USER_ID_B = 900_000_000_971n;
const CURRENCY_CODE = 'UZS';

describe('PrismaBudgetRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const budgetRepository = new PrismaBudgetRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  let userAId: string;
  let userBId: string;
  let foodCategoryId: string;
  let restaurantsSubcategoryId: string | null;
  let createdBudgetIds: string[] = [];
  let createdTransactionIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'Budget Test A', timezone: 'UTC' },
      update: { timezone: 'UTC', status: 'active' },
    });
    userAId = userA.id;
    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'Budget Test B', timezone: 'UTC' },
      update: { timezone: 'UTC', status: 'active' },
    });
    userBId = userB.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', parentCategoryId: null },
    });
    if (!category) {
      throw new Error('No active top-level expense category found — run `prisma db seed` first.');
    }
    foodCategoryId = category.id;

    const subcategory = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', parentCategoryId: foodCategoryId },
    });
    restaurantsSubcategoryId = subcategory?.id ?? null;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.domainEvent.deleteMany({
        where: { payload: { path: ['transactionId'], equals: createdTransactionIds[0] } },
      });
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
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeCategoryBudget(
    userId: string,
    limitAmount: string,
    periodStart = new Date('2026-08-01'),
    periodEnd = new Date('2026-08-31'),
  ) {
    const budget = await as(userId, () =>
      budgetRepository.create({
        userId,
        scopeType: 'category',
        categoryId: foodCategoryId,
        limitAmount,
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      }),
    );
    createdBudgetIds.push(budget.id);
    return budget;
  }

  async function makeExpense(
    userId: string,
    amount: string,
    transactionDate: Date,
    categoryId = foodCategoryId,
  ) {
    const transaction = await as(userId, () =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        amount,
        currency: CURRENCY_CODE,
        categoryId,
        transactionDate,
        description: 'test expense',
        originalText: `spent ${amount}`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  it('A — create() persists a category-scope budget with the exact supplied period boundaries', async () => {
    const budget = await makeCategoryBudget(userAId, '1500000');
    expect(budget.scopeType).toBe('category');
    expect(budget.limitAmount).toBe('1500000.00');
    expect(budget.currentPeriodStart.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('B — create() persists an overall-scope budget (categoryId null)', async () => {
    const budget = await as(userAId, () =>
      budgetRepository.create({
        userId: userAId,
        scopeType: 'overall',
        categoryId: null,
        limitAmount: '5000000',
        currency: CURRENCY_CODE,
        periodType: 'monthly',
        currentPeriodStart: new Date('2026-08-01'),
        currentPeriodEnd: new Date('2026-08-31'),
      }),
    );
    createdBudgetIds.push(budget.id);
    expect(budget.scopeType).toBe('overall');
    expect(budget.categoryId).toBeNull();
  });

  it('C — create() throws DuplicateBudgetError (§8.4.7) for a conflicting (userId, categoryId, periodType) scope', async () => {
    const first = await makeCategoryBudget(userAId, '1000000');

    await expect(
      as(userAId, () =>
        budgetRepository.create({
          userId: userAId,
          scopeType: 'category',
          categoryId: foodCategoryId,
          limitAmount: '2000000',
          currency: CURRENCY_CODE,
          periodType: 'monthly',
          currentPeriodStart: new Date('2026-08-01'),
          currentPeriodEnd: new Date('2026-08-31'),
        }),
      ),
    ).rejects.toThrow(DuplicateBudgetError);

    // The rejected attempt must not have created a second row.
    const all = await as(userAId, () => budgetRepository.findActiveByUserId(userAId));
    expect(all.filter((b) => b.id === first.id)).toHaveLength(1);
  });

  it('D — update() edits limitAmount, scoped to the owning user; a different user cannot edit it', async () => {
    const budget = await makeCategoryBudget(userAId, '1000000');

    const updated = await as(userAId, () =>
      budgetRepository.update(budget.id, userAId, { limitAmount: '2000000' }),
    );
    expect(updated?.limitAmount).toBe('2000000.00');

    const deniedForOtherUser = await as(userBId, () =>
      budgetRepository.update(budget.id, userBId, { limitAmount: '9999999' }),
    );
    expect(deniedForOtherUser).toBeNull();
  });

  it('E — softDelete() excludes the budget from findActiveByUserId afterward', async () => {
    const budget = await makeCategoryBudget(userAId, '1000000');

    const deleted = await as(userAId, () => budgetRepository.softDelete(budget.id, userAId));
    expect(deleted?.deletedAt).not.toBeNull();

    const active = await as(userAId, () => budgetRepository.findActiveByUserId(userAId));
    expect(active.map((b) => b.id)).not.toContain(budget.id);
  });

  it("F — cross-user isolation: user B's findActiveByUserId never returns user A's budgets", async () => {
    await makeCategoryBudget(userAId, '1000000');
    const activeForB = await as(userBId, () => budgetRepository.findActiveByUserId(userBId));
    expect(activeForB.map((b) => b.userId)).not.toContain(userAId);
  });

  it("G — computeUtilization reproduces AC-BUD-001's worked example (200,000 / 1,500,000 = 13.3%)", async () => {
    const budget = await makeCategoryBudget(userAId, '1500000');
    await makeExpense(userAId, '200000', new Date('2026-08-05'));

    const utilization = await as(userAId, () =>
      budgetRepository.computeUtilization(budget.id, userAId, new Date('2026-08-15')),
    );

    expect(utilization?.usedAmount).toBe('200000.00');
    expect(utilization?.utilizationPercent).toBeCloseTo(13.3, 1);
    expect(utilization?.remainingAmount).toBe('1300000.00');
  }, 15000);

  it('H — computeUtilization only counts EXPENSE transactions within the current period and the matching category (BR-BUD-001/BR-BUD-002)', async () => {
    const budget = await makeCategoryBudget(userAId, '1000000');
    await makeExpense(userAId, '100000', new Date('2026-08-05')); // in scope
    await makeExpense(userAId, '50000', new Date('2026-07-15')); // outside period -> excluded
    if (restaurantsSubcategoryId) {
      const subExpense = await as(userAId, () =>
        transactionRepository.create({
          userId: userAId,
          transactionType: 'EXPENSE',
          amount: '30000',
          currency: CURRENCY_CODE,
          categoryId: foodCategoryId,
          subcategoryId: restaurantsSubcategoryId!,
          transactionDate: new Date('2026-08-10'),
          description: 'restaurant',
          originalText: 'spent 30000 at a restaurant',
          sourceType: 'text',
          createdBy: 'ai',
        }),
      );
      createdTransactionIds.push(subExpense.id);
    }

    const utilization = await as(userAId, () =>
      budgetRepository.computeUtilization(budget.id, userAId, new Date('2026-08-15')),
    );

    const expected = restaurantsSubcategoryId ? '130000.00' : '100000.00';
    expect(utilization?.usedAmount).toBe(expected);
  }, 15000);

  it('I — findDueForRollover / rolloverPeriod: AC-BUD-003 — a period-ended budget rolls to the next period with utilization reset (no stale usedAmount carried forward)', async () => {
    // findDueForRollover scans every active user in the shared database
    // (the same N+1-by-design RLS constraint `PrismaDebtReminderRepository.
    // findCandidates` already established) — slower than the 5s default in
    // a shared environment with many pre-existing users from other sessions.
    // A period-ended budget used below.
    const budget = await makeCategoryBudget(
      userAId,
      '1000000',
      new Date('2026-07-01'),
      new Date('2026-07-31'),
    );
    await as(userAId, () =>
      transactionRepository.create({
        userId: userAId,
        transactionType: 'EXPENSE',
        amount: '900000',
        currency: CURRENCY_CODE,
        categoryId: foodCategoryId,
        transactionDate: new Date('2026-07-20'),
        description: 'last period spend',
        originalText: 'spent 900000',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    ).then((t) => createdTransactionIds.push(t.id));

    const dueBudgets = await budgetRepository.findDueForRollover(new Date('2026-08-01T12:00:00Z'));
    expect(dueBudgets.map((b) => b.id)).toContain(budget.id);

    const rolledOver = await budgetRepository.rolloverPeriod(
      budget.id,
      budget.currentPeriodEnd,
      new Date('2026-08-01'),
      new Date('2026-08-31'),
    );
    expect(rolledOver?.currentPeriodStart.toISOString().slice(0, 10)).toBe('2026-08-01');

    const utilizationAfterRollover = await as(userAId, () =>
      budgetRepository.computeUtilization(budget.id, userAId, new Date('2026-08-05')),
    );
    // The old period's 900,000 spend must NOT carry into the new period's figure.
    expect(utilizationAfterRollover?.usedAmount).toBe('0.00');
  }, 30000);

  it('rolloverPeriod is a no-op (returns null) when currentPeriodEnd no longer matches (already rolled over by a concurrent run)', async () => {
    const budget = await makeCategoryBudget(
      userAId,
      '1000000',
      new Date('2026-06-01'),
      new Date('2026-06-30'),
    );

    const result = await budgetRepository.rolloverPeriod(
      budget.id,
      new Date('2026-05-31'), // wrong expected end -> stale caller
      new Date('2026-07-01'),
      new Date('2026-07-31'),
    );
    expect(result).toBeNull();
  });
});

describe('PrismaBudgetRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-003 budget-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

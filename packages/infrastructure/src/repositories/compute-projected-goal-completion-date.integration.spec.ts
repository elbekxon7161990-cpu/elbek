import { GoalProgressUnavailableError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { computeProjectedGoalCompletionDate } from './compute-projected-goal-completion-date';
import { PrismaSavingsGoalRepository } from './prisma-savings-goal.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-008 (§8.14.5's second formula) — real-Postgres proof for
 * `computeProjectedGoalCompletionDate`, the ONE shared implementation of
 * `projected_completion_date(goal)`. Tested directly, the same convention
 * every sibling formula in this task establishes.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID = 900_000_001_060n;
const DEFAULT_CURRENCY = 'UZS';
const USD = 'USD';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// 2025-08 — a past, distinct-from-every-other-suite's-own fixture window.
const TODAY = new Date('2025-08-30');

describe('computeProjectedGoalCompletionDate — TASK-FIN-008 (§8.14.5, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const savingsGoalRepository = new PrismaSavingsGoalRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);

  let userId: string;
  let categoryId: string;
  let createdGoalIds: string[] = [];
  let createdTransactionIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const user = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Projected Completion Date Test',
        timezone: 'UTC',
      },
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
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    if (createdGoalIds.length > 0) {
      await prisma.savingsGoal.deleteMany({ where: { id: { in: createdGoalIds } } });
    }
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: USD,
        quoteCurrency: DEFAULT_CURRENCY,
        asOfDate: { gte: new Date('2025-08-01') },
      },
    });
    createdTransactionIds = [];
    createdGoalIds = [];
  });

  afterAll(async () => {
    await prisma.savingsGoal.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function makeGoal(targetAmount: string) {
    const goal = await as(() =>
      savingsGoalRepository.create({
        userId,
        name: 'Test Goal',
        targetAmount,
        currency: DEFAULT_CURRENCY,
        targetDate: null,
      }),
    );
    createdGoalIds.push(goal.id);
    return goal;
  }

  async function makeContribution(
    goalId: string,
    amount: string,
    transactionDate: Date,
    currency = DEFAULT_CURRENCY,
  ) {
    const transaction = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'GOAL_CONTRIBUTION',
        amount,
        currency,
        goalId,
        categoryId,
        transactionDate,
        description: 'contribution',
        originalText: `contribution ${amount} ${currency}`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  it('A — normal case: an older out-of-window contribution counts toward current_progress but NOT toward the trailing-30-day rate', async () => {
    const goal = await makeGoal('1000000.00');
    const createdAt = new Date(TODAY.getTime() - 60 * MS_PER_DAY); // comfortably before the 30-day window
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { createdAt } });

    await makeContribution(goal.id, '200000.00', new Date('2025-07-15')); // before windowStart (2025-07-31) — excluded from the rate
    await makeContribution(goal.id, '150000.00', new Date('2025-08-05')); // within window
    await makeContribution(goal.id, '150000.00', new Date('2025-08-20')); // within window
    // current_progress (all-time) = 200,000 + 150,000 + 150,000 = 500,000
    // windowed contribution = 150,000 + 150,000 = 300,000, over 30 days = 10,000/day
    // remaining = 1,000,000 - 500,000 = 500,000 -> daysNeeded = ceil(500,000 / 10,000) = 50

    const result = await computeProjectedGoalCompletionDate(prisma, {
      goalId: goal.id,
      currency: DEFAULT_CURRENCY,
      targetAmount: '1000000.00',
      createdAt,
      today: TODAY,
    });
    expect(result?.getTime()).toBe(TODAY.getTime() + 50 * MS_PER_DAY);
  });

  it('B — edge case A: zero contributions within the trailing window returns null, never a fabricated date', async () => {
    const goal = await makeGoal('1000000.00');
    const createdAt = new Date(TODAY.getTime() - 60 * MS_PER_DAY);
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { createdAt } });

    await makeContribution(goal.id, '200000.00', new Date('2025-07-01')); // all-time progress exists, but entirely before windowStart

    const result = await computeProjectedGoalCompletionDate(prisma, {
      goalId: goal.id,
      currency: DEFAULT_CURRENCY,
      targetAmount: '1000000.00',
      createdAt,
      today: TODAY,
    });
    expect(result).toBeNull();
  });

  it('C — edge case B: a goal younger than 30 days uses its actual elapsed age, never zero-padded to 30', async () => {
    const goal = await makeGoal('1000000.00');
    const createdAt = new Date(TODAY.getTime() - 10 * MS_PER_DAY); // only 10 days old
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { createdAt } });

    await makeContribution(goal.id, '100000.00', new Date(TODAY.getTime() - 5 * MS_PER_DAY));
    // windowed contribution = 100,000 over the goal's ACTUAL 10-day age = 10,000/day
    // (if incorrectly divided by a flat 30 instead, the rate would be 3,333.33/day — a different, wrong result)
    // current_progress = 100,000; remaining = 900,000 -> daysNeeded = ceil(900,000 / 10,000) = 90

    const result = await computeProjectedGoalCompletionDate(prisma, {
      goalId: goal.id,
      currency: DEFAULT_CURRENCY,
      targetAmount: '1000000.00',
      createdAt,
      today: TODAY,
    });
    expect(result?.getTime()).toBe(TODAY.getTime() + 90 * MS_PER_DAY);
  });

  it('D — edge case C: a goal already at or past its target returns today directly, never a future projection', async () => {
    const goal = await makeGoal('500000.00');
    const createdAt = new Date(TODAY.getTime() - 60 * MS_PER_DAY);
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { createdAt } });

    await makeContribution(goal.id, '600000.00', new Date('2025-08-01')); // past the 500,000 target

    const result = await computeProjectedGoalCompletionDate(prisma, {
      goalId: goal.id,
      currency: DEFAULT_CURRENCY,
      targetAmount: '500000.00',
      createdAt,
      today: TODAY,
    });
    expect(result?.getTime()).toBe(TODAY.getTime());
  });

  it('E — throws GoalProgressUnavailableError when no exchange rate exists for a cross-currency contribution (FR-FIN-043)', async () => {
    const goal = await makeGoal('1000000.00');
    const createdAt = new Date(TODAY.getTime() - 60 * MS_PER_DAY);
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { createdAt } });

    await makeContribution(goal.id, '100.00', new Date('2025-08-10'), USD); // no fx_rates row recorded

    await expect(
      computeProjectedGoalCompletionDate(prisma, {
        goalId: goal.id,
        currency: DEFAULT_CURRENCY,
        targetAmount: '1000000.00',
        createdAt,
        today: TODAY,
      }),
    ).rejects.toThrow(GoalProgressUnavailableError);
  });

  it('F — the trailing window boundary is inclusive: a contribution dated exactly at windowStart counts toward the rate', async () => {
    const goal = await makeGoal('1000000.00');
    const createdAt = new Date(TODAY.getTime() - 60 * MS_PER_DAY);
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { createdAt } });

    const windowStart = new Date(TODAY.getTime() - 30 * MS_PER_DAY);
    await makeContribution(goal.id, '300000.00', windowStart); // exactly at the boundary
    // windowed contribution = 300,000 over 30 days = 10,000/day
    // current_progress = 300,000; remaining = 700,000 -> daysNeeded = ceil(700,000 / 10,000) = 70

    const result = await computeProjectedGoalCompletionDate(prisma, {
      goalId: goal.id,
      currency: DEFAULT_CURRENCY,
      targetAmount: '1000000.00',
      createdAt,
      today: TODAY,
    });
    expect(result?.getTime()).toBe(TODAY.getTime() + 70 * MS_PER_DAY);
  });
});

describe('computeProjectedGoalCompletionDate — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log(
      'TASK-FIN-008 projected-goal-completion-date environment gate:',
      JSON.stringify(status),
    );
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

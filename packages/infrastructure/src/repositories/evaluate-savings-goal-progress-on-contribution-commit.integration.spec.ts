import { randomUUID } from 'node:crypto';
import {
  GoalProgressUnavailableError,
  parseGoalCompletedPayload,
  parseGoalMilestoneReachedPayload,
} from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { computeSavingsGoalProgress } from './compute-savings-goal-progress';
import { evaluateSavingsGoalProgressOnContributionCommit } from './evaluate-savings-goal-progress-on-contribution-commit';
import { PrismaSavingsGoalRepository } from './prisma-savings-goal.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-004 (Stage E, FR-FIN-013/014, §8.14.5) — real-Postgres proof that
 * `PrismaTransactionRepository.create()`'s synchronous savings-goal
 * progress/milestone hook fires correctly: single and multi-threshold
 * crossings, completion transition, no-refire past completion, the
 * standalone-`GOAL_CONTRIBUTION`-vs-linked-`TRANSFER` dual mechanism both
 * counting toward progress, cross-currency conversion, the missing-FX-rate
 * best-effort skip, and concurrency safety. Mirrors
 * `evaluate-budget-thresholds-on-expense-commit.integration.spec.ts`'s own
 * "drive it through `PrismaTransactionRepository.create()`, not directly"
 * convention exactly. Owner-role connection, matching every real-Postgres
 * suite in this package.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID = 900_000_000_960n;
const UZS = 'UZS';
const USD = 'USD';

describe('evaluateSavingsGoalProgressOnContributionCommit (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const savingsGoalRepository = new PrismaSavingsGoalRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);

  let userId: string;
  let categoryId: string;
  let accountId: string;
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
        displayName: 'TASK-FIN-004 Stage E Goal Progress Test',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: UZS },
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'neutral', status: 'active', code: 'SAVINGS' },
    });
    if (!category) {
      throw new Error('No active "SAVINGS" category found — run `prisma db seed` first.');
    }
    categoryId = category.id;

    const account = await prisma.account.create({
      data: {
        userId,
        name: 'Cash',
        accountType: 'cash',
        currency: UZS,
        startingBalance: '0',
      },
    });
    accountId = account.id;
  });

  afterEach(async () => {
    if (createdGoalIds.length > 0) {
      const events = await prisma.domainEvent.findMany({
        where: { eventType: { in: ['GoalMilestoneReached', 'GoalCompleted'] } },
      });
      const relevantEventIds = events
        .filter((event) => createdGoalIds.includes((event.payload as { goalId: string }).goalId))
        .map((event) => event.id);
      if (relevantEventIds.length > 0) {
        await prisma.domainEvent.deleteMany({ where: { id: { in: relevantEventIds } } });
      }
    }
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    if (createdGoalIds.length > 0) {
      await prisma.savingsGoal.deleteMany({ where: { id: { in: createdGoalIds } } });
    }
    createdTransactionIds = [];
    createdGoalIds = [];
    await prisma.fxRate.deleteMany({
      where: { baseCurrency: USD, quoteCurrency: UZS, asOfDate: { gte: new Date('2026-08-01') } },
    });
  });

  /** Every `GoalMilestoneReached`/`GoalCompleted` domain_events row whose payload references this goal, oldest first. */
  async function findGoalEvents(goalId: string) {
    const events = await prisma.domainEvent.findMany({
      where: { eventType: { in: ['GoalMilestoneReached', 'GoalCompleted'] } },
      orderBy: { createdAt: 'asc' },
    });
    return events.filter((event) => (event.payload as { goalId: string }).goalId === goalId);
  }

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.savingsGoal.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function makeGoal(targetAmount: string) {
    const goal = await as(() =>
      savingsGoalRepository.create({
        userId,
        name: `Goal ${randomUUID()}`,
        targetAmount,
        currency: UZS,
        targetDate: null,
      }),
    );
    createdGoalIds.push(goal.id);
    return goal;
  }

  async function contribute(goalId: string, amount: string, currency = UZS) {
    const txn = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'GOAL_CONTRIBUTION',
        amount,
        currency,
        goalId,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'contribution',
        originalText: `contribution ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(txn.id);
    return txn;
  }

  async function linkedTransfer(goalId: string, amount: string) {
    const otherAccount = await prisma.account.create({
      data: { userId, name: 'Bank', accountType: 'bank_card', currency: UZS, startingBalance: '0' },
    });
    const txn = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'TRANSFER',
        amount,
        currency: UZS,
        sourceAccountId: accountId,
        destinationAccountId: otherAccount.id,
        goalId,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'linked transfer',
        originalText: `linked transfer ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(txn.id);
    return txn;
  }

  it('A — a contribution crossing exactly one threshold updates lastMilestoneFired, stays active', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '300000.00'); // 30% — crosses 25%

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(25);
    expect(found?.status).toBe('active');
  }, 15_000);

  it('B — a single contribution crossing multiple thresholds at once records the HIGHEST one', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '800000.00'); // 80% in one jump — crosses 25, 50, 75

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(75);
    expect(found?.status).toBe('active');
  }, 15_000);

  it('C — reaching exactly 100% fires the 100 milestone AND transitions status to "completed" (FR-FIN-014)', async () => {
    const goal = await makeGoal('500000.00');

    await contribute(goal.id, '500000.00'); // exactly 100%

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(100);
    expect(found?.status).toBe('completed');
  }, 15_000);

  it('D — a further contribution past 100% never re-fires and never re-opens a completed goal (FR-FIN-014 — further contributions remain possible)', async () => {
    const goal = await makeGoal('500000.00');
    await contribute(goal.id, '500000.00'); // reaches completion

    const secondContribution = await contribute(goal.id, '100000.00'); // now 120%

    expect(secondContribution.transactionType).toBe('GOAL_CONTRIBUTION');
    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(100);
    expect(found?.status).toBe('completed');
  }, 15_000);

  it('E — sequential contributions cross progressively higher thresholds, never going backward', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '260000.00'); // 26% — crosses 25
    let found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(25);

    await contribute(goal.id, '260000.00'); // 52% total — crosses 50
    found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(50);
  }, 15_000);

  it('F — a standalone GOAL_CONTRIBUTION and a goal-linked TRANSFER both count toward the SAME goal’s progress (FR-FIN-012 dual mechanism)', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '150000.00'); // 15%
    await linkedTransfer(goal.id, '150000.00'); // +15% = 30% total — crosses 25

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(25);

    const progress = await as(() =>
      computeSavingsGoalProgress(prisma, {
        goalId: goal.id,
        currency: UZS,
        targetAmount: '1000000.00',
      }),
    );
    expect(progress.contributedAmount).toBe('300000.00');
  }, 15_000);

  it('G — a cross-currency contribution is converted to the goal’s own currency before computing progress (BR-FIN-006)', async () => {
    const goal = await makeGoal('1000000.00');
    await prisma.fxRate.create({
      data: {
        baseCurrency: USD,
        quoteCurrency: UZS,
        rate: '12500.00',
        asOfDate: new Date('2026-08-01'),
      },
    });

    await contribute(goal.id, '20.00', USD); // 20 * 12500 = 250000 UZS = 25%

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(25);
  }, 15_000);

  it('H1 — a missing FX rate for an unrelated historical contribution never blocks a NEW, otherwise-valid contribution from being created (best-effort disclosed decision)', async () => {
    const goal = await makeGoal('1000000.00');
    // A cross-currency contribution with NO fx_rates row seeded at all —
    // computeSavingsGoalProgress will be unable to convert it.
    const unresolvable = await contribute(goal.id, '5.00', USD);
    expect(unresolvable.id).toBeTruthy();

    // A second, same-currency contribution must still succeed — the hook
    // catches GoalProgressUnavailableError internally rather than
    // propagating it and rejecting this otherwise-valid write.
    const secondContribution = await contribute(goal.id, '100000.00', UZS);
    expect(secondContribution.id).toBeTruthy();

    const rows = await prisma.transaction.findMany({
      where: { id: { in: [unresolvable.id, secondContribution.id] } },
    });
    expect(rows).toHaveLength(2);
  }, 15_000);

  it('H2 — computeSavingsGoalProgress itself (called directly, not through the hook) still fails loudly per FR-FIN-043', async () => {
    const goal = await makeGoal('1000000.00');
    await contribute(goal.id, '5.00', USD); // no fx_rates row seeded

    await expect(
      as(() =>
        computeSavingsGoalProgress(prisma, {
          goalId: goal.id,
          currency: UZS,
          targetAmount: '1000000.00',
        }),
      ),
    ).rejects.toThrow(GoalProgressUnavailableError);
  }, 15_000);

  it('I — an unrelated EXPENSE transaction never affects any goal’s progress/milestone state', async () => {
    const goal = await makeGoal('1000000.00');

    const expense = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        amount: '50000.00',
        currency: UZS,
        accountId,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'unrelated expense',
        originalText: `unrelated expense ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(expense.id);

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBeNull();
    expect(found?.status).toBe('active');
  }, 15_000);

  it('J — an un-linked TRANSFER (no goalId) never affects any goal — the hook does not even fire', async () => {
    const goal = await makeGoal('1000000.00');
    const otherAccount = await prisma.account.create({
      data: {
        userId,
        name: 'Bank2',
        accountType: 'bank_card',
        currency: UZS,
        startingBalance: '0',
      },
    });

    const transfer = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'TRANSFER',
        amount: '900000.00',
        currency: UZS,
        sourceAccountId: accountId,
        destinationAccountId: otherAccount.id,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'unlinked transfer',
        originalText: `unlinked transfer ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(transfer.id);

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBeNull();
  }, 15_000);

  it('K — concurrent contributions crossing the same threshold together only record it once (race-safe atomic conditional UPDATE)', async () => {
    const goal = await makeGoal('1000000.00');

    // Two concurrent 300000 contributions: individually each is 30% (crosses
    // 25 alone), together 60% (crosses 25 AND 50) — regardless of commit
    // order, the final state must be the highest threshold actually
    // reached by the combined total, recorded exactly once, never
    // corrupted by the race.
    await Promise.all([contribute(goal.id, '300000.00'), contribute(goal.id, '300000.00')]);

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(50);

    const progress = await as(() =>
      computeSavingsGoalProgress(prisma, {
        goalId: goal.id,
        currency: UZS,
        targetAmount: '1000000.00',
      }),
    );
    expect(progress.contributedAmount).toBe('600000.00');
  }, 15_000);

  it('L — TASK-FIN-004 (FR-FIN-013): a newly-crossed milestone produces exactly one GoalMilestoneReached domain_events row, with a payload matching the catalogued shape', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '300000.00'); // 30% — crosses 25

    const events = await findGoalEvents(goal.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('GoalMilestoneReached');
    expect(events[0]!.status).toBe('pending');
    const payload = parseGoalMilestoneReachedPayload(events[0]!.payload as Record<string, unknown>);
    expect(payload.goalId).toBe(goal.id);
    expect(payload.userId).toBe(userId);
    expect(payload.thresholdPercent).toBe(25);
    expect(payload.progressPercent).toBe(30);
    expect(payload.targetAmount).toBe('1000000.00');
    expect(payload.currency).toBe(UZS);
  }, 15_000);

  it('M — a single contribution crossing multiple thresholds at once produces one GoalMilestoneReached event PER threshold (mirrors the Budget producer’s own multi-threshold loop)', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '800000.00'); // 80% in one jump — crosses 25, 50, 75

    const events = await findGoalEvents(goal.id);
    expect(events).toHaveLength(3);
    expect(
      events.map((event) => (event.payload as { thresholdPercent: number }).thresholdPercent),
    ).toEqual([25, 50, 75]);
  }, 15_000);

  it('N — a further contribution that does NOT cross a new threshold produces no additional event (no duplicate for an already-fired milestone)', async () => {
    const goal = await makeGoal('1000000.00');
    await contribute(goal.id, '300000.00'); // 30% — crosses 25, 1 event

    await contribute(goal.id, '10000.00'); // 31% — still below 50, no new threshold

    const events = await findGoalEvents(goal.id);
    expect(events).toHaveLength(1);
  }, 15_000);

  it('O — sequential contributions crossing progressively higher thresholds each produce exactly one new event, never re-firing the earlier one', async () => {
    const goal = await makeGoal('1000000.00');

    await contribute(goal.id, '260000.00'); // 26% — crosses 25
    await contribute(goal.id, '260000.00'); // 52% total — crosses 50

    const events = await findGoalEvents(goal.id);
    expect(events).toHaveLength(2);
    expect(
      events.map((event) => (event.payload as { thresholdPercent: number }).thresholdPercent),
    ).toEqual([25, 50]);
  }, 15_000);

  it('P — a final contribution that crosses ONLY the 100 threshold (having already crossed 25/50/75 earlier) produces exactly one GoalCompleted event, never also a GoalMilestoneReached for that same crossing (FR-FIN-014)', async () => {
    const goal = await makeGoal('1000000.00');
    await contribute(goal.id, '800000.00'); // 80% — crosses 25, 50, 75 (3 events; not this test's assertion)

    await contribute(goal.id, '200000.00'); // 100% total — crosses ONLY 100

    const events = await findGoalEvents(goal.id);
    const completedEvents = events.filter((event) => event.eventType === 'GoalCompleted');
    expect(completedEvents).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.eventType === 'GoalMilestoneReached' &&
          (event.payload as { thresholdPercent: number }).thresholdPercent === 100,
      ),
    ).toBe(false);
    const payload = parseGoalCompletedPayload(
      completedEvents[0]!.payload as Record<string, unknown>,
    );
    expect(payload.goalId).toBe(goal.id);
    expect(payload.targetAmount).toBe('1000000.00');
    expect(payload.currency).toBe(UZS);
  }, 15_000);

  it('Q — a further contribution past 100% never re-fires GoalCompleted (FR-FIN-014 — further contributions remain possible, without a repeat notification)', async () => {
    const goal = await makeGoal('500000.00');
    // A single contribution reaching 100% in one jump from zero legitimately
    // crosses 25/50/75/100 all at once (the same documented multi-threshold
    // semantics test M exercises) — 4 events, exactly one of them GoalCompleted.
    await contribute(goal.id, '500000.00');
    const eventsAfterCompletion = await findGoalEvents(goal.id);
    expect(
      eventsAfterCompletion.filter((event) => event.eventType === 'GoalCompleted'),
    ).toHaveLength(1);

    await contribute(goal.id, '100000.00'); // now 120% — no new event of any kind

    const eventsAfterSecond = await findGoalEvents(goal.id);
    expect(eventsAfterSecond).toHaveLength(eventsAfterCompletion.length);
    expect(eventsAfterSecond.filter((event) => event.eventType === 'GoalCompleted')).toHaveLength(
      1,
    );
  }, 15_000);

  it('R — an unrelated EXPENSE transaction never produces a goal event', async () => {
    const goal = await makeGoal('1000000.00');

    const expense = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        amount: '50000.00',
        currency: UZS,
        accountId,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'unrelated expense',
        originalText: `unrelated expense ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(expense.id);

    expect(await findGoalEvents(goal.id)).toHaveLength(0);
  }, 15_000);

  it('S — an un-linked TRANSFER (no goalId) never produces a goal event', async () => {
    const goal = await makeGoal('1000000.00');
    const otherAccount = await prisma.account.create({
      data: {
        userId,
        name: 'Bank3',
        accountType: 'bank_card',
        currency: UZS,
        startingBalance: '0',
      },
    });

    const transfer = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'TRANSFER',
        amount: '900000.00',
        currency: UZS,
        sourceAccountId: accountId,
        destinationAccountId: otherAccount.id,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'unlinked transfer',
        originalText: `unlinked transfer ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(transfer.id);

    expect(await findGoalEvents(goal.id)).toHaveLength(0);
  }, 15_000);

  it('T — concurrent contributions crossing thresholds together produce the correct events exactly once, never duplicated (race-safe: recomputed against the TRUE previous value the atomic UPDATE observed, not the possibly-stale value read at hook entry)', async () => {
    const goal = await makeGoal('1000000.00');

    // Two concurrent 300000 contributions: individually each is 30% (crosses
    // 25 alone), together 60% (crosses 25 AND 50). Regardless of which
    // commits first, the combined event set must be exactly {25, 50} once
    // each — never {25,50} from one side AND {25} or {25,50} again from the
    // other (the exact duplicate-event failure mode this stage's own
    // correction targets).
    await Promise.all([contribute(goal.id, '300000.00'), contribute(goal.id, '300000.00')]);

    const events = await findGoalEvents(goal.id);
    const thresholds = events
      .map((event) => (event.payload as { thresholdPercent: number }).thresholdPercent)
      .sort((a, b) => a - b);
    expect(thresholds).toEqual([25, 50]);
  }, 15_000);

  it('U — TASK-FIN-004 (SavingsGoal concurrency hardening): if the enclosing transaction rolls back, the GoalMilestoneReached event AND the lastMilestoneFired write the hook made inside it roll back too — real Postgres proof of atomicity, not merely assumed from both writes sharing one $transaction', async () => {
    const goal = await makeGoal('1000000.00');
    await contribute(goal.id, '260000.00'); // 26% — crosses 25, committed normally (baseline, not under test)

    const eventsBefore = await findGoalEvents(goal.id);
    expect(eventsBefore).toHaveLength(1);

    const forcedRollbackDescription = `forced-rollback-${randomUUID()}`;
    const forcedError = new Error('FORCED_ROLLBACK_TEST_MARKER');

    // A second contribution that, combined with the 26% already committed,
    // would cross 50% — driving the hook to insert a NEW GoalMilestoneReached
    // event and update lastMilestoneFired to 50, all inside a transaction
    // this test deliberately fails AFTER those writes, but BEFORE commit.
    await expect(
      as(() =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
          await tx.transaction.create({
            data: {
              userId,
              transactionType: 'GOAL_CONTRIBUTION',
              amount: '260000.00',
              currency: UZS,
              goalId: goal.id,
              categoryId,
              transactionDate: new Date('2026-08-17'),
              description: forcedRollbackDescription,
              originalText: `forced rollback ${randomUUID()}`,
              sourceType: 'manual',
              createdBy: 'user_manual',
              tags: [],
              isRecurringDetected: false,
            },
          });
          await evaluateSavingsGoalProgressOnContributionCommit(tx, { goalId: goal.id });
          throw forcedError; // forces Prisma to roll back the entire transaction
        }),
      ),
    ).rejects.toThrow('FORCED_ROLLBACK_TEST_MARKER');

    // Nothing from the failed transaction persisted: not the transaction
    // row, not the event, not the lastMilestoneFired update.
    const orphanedRows = await prisma.transaction.findMany({
      where: { description: forcedRollbackDescription },
    });
    expect(orphanedRows).toHaveLength(0);

    const eventsAfter = await findGoalEvents(goal.id);
    expect(eventsAfter).toHaveLength(1); // still only the baseline 25% event
    expect(eventsAfter.map((event) => event.id)).toEqual(eventsBefore.map((event) => event.id));

    const found = await as(() => savingsGoalRepository.findById(goal.id));
    expect(found?.lastMilestoneFired).toBe(25); // NOT 50 — the rolled-back write never took effect
  }, 15_000);
});

describe('evaluateSavingsGoalProgressOnContributionCommit — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-004 Stage E goal-progress environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

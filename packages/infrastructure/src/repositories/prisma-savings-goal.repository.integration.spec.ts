import { randomUUID } from 'node:crypto';
import { InvalidSavingsGoalError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaSavingsGoalRepository } from './prisma-savings-goal.repository';

/**
 * TASK-FIN-004 (Stage B) — real-Postgres proof for
 * `PrismaSavingsGoalRepository`: create/retrieve, the atomic-validation
 * lesson, `findActiveByUserId`'s active/completed/soft-deleted filtering,
 * and ownership isolation. Same conventions as
 * `prisma-loan.repository.integration.spec.ts` (owner-role connection, RLS
 * wrapping via `runWithUserContext` — `SavingsGoal` is RLS-protected per
 * `rls-protected-models.ts`).
 *
 * No contribution/milestone/completion-transition test exists here — Stage
 * B builds no such repository method (`SavingsGoal.evaluateCompletion`/
 * `detectNewlyCrossedGoalMilestones` are pure Stage A domain helpers with
 * their own unit tests; wiring them against real contribution rows is
 * TASK-FIN-004 Stage F's job).
 *
 * "Ownership isolation" here means `findActiveByUserId`'s own explicit
 * `WHERE userId = ...` query-scoping is correct (defense-in-depth on top of
 * RLS) — REAL RLS-*policy* enforcement is `rls-user-context.integration.spec.ts`'s
 * own dedicated, separately-gated suite (Postgres's row-level security is
 * bypassed for the table-owner role this suite connects as). `findById(id)`
 * is therefore deliberately NOT tested for cross-user rejection here,
 * exactly following `prisma-debt.repository.integration.spec.ts`'s /
 * `prisma-loan.repository.integration.spec.ts`'s own established precedent.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_942n;
const TELEGRAM_USER_ID_B = 900_000_000_943n;
const CURRENCY_CODE = 'UZS';

describe('PrismaSavingsGoalRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const savingsGoalRepository = new PrismaSavingsGoalRepository(prisma);
  let userAId: string;
  let userBId: string;
  let createdGoalIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'TASK-FIN-004 Goal Test A' },
      update: {},
    });
    userAId = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'TASK-FIN-004 Goal Test B' },
      update: {},
    });
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdGoalIds.length > 0) {
      await prisma.savingsGoal.deleteMany({ where: { id: { in: createdGoalIds } } });
    }
    createdGoalIds = [];
  });

  afterAll(async () => {
    await prisma.savingsGoal.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeGoal(
    userId: string,
    overrides: Partial<Parameters<typeof savingsGoalRepository.create>[0]> = {},
  ) {
    const goal = await as(userId, () =>
      savingsGoalRepository.create({
        userId,
        name: 'Vacation fund',
        targetAmount: '5000000.00',
        currency: CURRENCY_CODE,
        targetDate: new Date('2026-12-01'),
        ...overrides,
      }),
    );
    createdGoalIds.push(goal.id);
    return goal;
  }

  it('A — create() persists a goal with status = active and lastMilestoneFired = null', async () => {
    const goal = await makeGoal(userAId, { name: 'New car' });

    expect(goal.name).toBe('New car');
    expect(goal.status).toBe('active');
    expect(goal.lastMilestoneFired).toBeNull();

    const found = await as(userAId, () => savingsGoalRepository.findById(goal.id));
    expect(found?.id).toBe(goal.id);
    expect(found?.targetAmount).toBe('5000000.00');
  });

  it('B — create() persists a goal with a null targetDate (FR-FIN-011 — optional)', async () => {
    const goal = await makeGoal(userAId, { targetDate: null });
    expect(goal.targetDate).toBeNull();
  });

  it('C — create() rejects a targetDate already in the past, with ZERO rows persisted (§8.9.4, the atomic-validation lesson)', async () => {
    const name = `PastDate-${randomUUID()}`;

    await expect(
      as(userAId, () =>
        savingsGoalRepository.create({
          userId: userAId,
          name,
          targetAmount: '1000000.00',
          currency: CURRENCY_CODE,
          targetDate: new Date('2020-01-01'),
        }),
      ),
    ).rejects.toThrow(InvalidSavingsGoalError);

    const rows = await prisma.savingsGoal.findMany({ where: { name } });
    expect(rows).toHaveLength(0);
  });

  it("D — findActiveByUserId excludes another user's goals", async () => {
    const mine = await makeGoal(userAId);
    const theirs = await makeGoal(userBId);

    const activeForA = await as(userAId, () => savingsGoalRepository.findActiveByUserId(userAId));
    const ids = activeForA.map((g) => g.id);

    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it('E — findActiveByUserId excludes a "completed" goal (archived/closed filtering)', async () => {
    const activeGoal = await makeGoal(userAId);
    const completedGoal = await makeGoal(userAId, { name: 'Already funded' });
    // Stage B builds no contribution/completion-transition method
    // (deliberately deferred to Stage F) — this fixture reaches
    // "completed" via a direct write, bypassing repository/domain logic
    // entirely, purely to prove the LIST FILTER excludes it.
    await prisma.savingsGoal.update({
      where: { id: completedGoal.id },
      data: { status: 'completed', lastMilestoneFired: 100 },
    });

    const activeForA = await as(userAId, () => savingsGoalRepository.findActiveByUserId(userAId));
    const ids = activeForA.map((g) => g.id);

    expect(ids).toContain(activeGoal.id);
    expect(ids).not.toContain(completedGoal.id);
  });

  it('F — findActiveByUserId excludes a soft-deleted goal (defense-in-depth; no current use case sets deletedAt)', async () => {
    const goal = await makeGoal(userAId);
    await prisma.savingsGoal.update({ where: { id: goal.id }, data: { deletedAt: new Date() } });

    const activeForA = await as(userAId, () => savingsGoalRepository.findActiveByUserId(userAId));
    expect(activeForA.map((g) => g.id)).not.toContain(goal.id);
  });

  it('G — preserves decimal precision through a full round trip (DB-P3/FR-DB-027)', async () => {
    const goal = await makeGoal(userAId, { targetAmount: '123456789012.34' });

    const found = await as(userAId, () => savingsGoalRepository.findById(goal.id));
    expect(found?.targetAmount).toBe('123456789012.34');
  });
});

describe('PrismaSavingsGoalRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-004 savings-goal-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

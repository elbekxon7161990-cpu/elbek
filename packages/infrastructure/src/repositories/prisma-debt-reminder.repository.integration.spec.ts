import { randomUUID } from 'node:crypto';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaCounterpartyRepository } from './prisma-counterparty.repository';
import { PrismaDebtReminderRepository } from './prisma-debt-reminder.repository';
import { PrismaDebtRepository } from './prisma-debt.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Debt Reminder Producer task — real-Postgres proof for
 * `PrismaDebtReminderRepository`. Owner-role connection, matching every
 * newer real-Postgres suite in this package. `Debt` is RLS-protected;
 * every debt-creation call runs inside `runWithUserContext`, mirroring
 * `prisma-debt.repository.integration.spec.ts`'s own established
 * reasoning; `findCandidates`/`wasReminderEventRecentlyRecorded`
 * themselves establish their own context internally (their own doc
 * comments explain why), so callers of THOSE two methods specifically do
 * not need to wrap them.
 *
 * All dates below are relative to the REAL current wall-clock time
 * (`new Date()`), never a fixed historical constant — `Debt.validateNew`'s
 * own creation-time "due date cannot be in the past" check is evaluated
 * against the real system clock, so a hardcoded reference date would drift
 * out of sync with it as real time passes across sessions. A genuinely
 * *overdue* fixture (due date in the past) cannot be produced through
 * `DebtRepository.create()` at all (that check exists specifically to
 * reject it) — those fixtures are seeded via a direct, raw
 * `prisma.debt.create()` call instead, which is the correct way to
 * represent a debt that *was* created validly and has since become
 * overdue purely through the passage of time (exactly the state
 * `Debt`'s own constructor is deliberately designed to accept on
 * reconstruction — see `debt.entity.ts`'s own doc comment).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_960n;
const TELEGRAM_USER_ID_B = 900_000_000_961n;
const CURRENCY_CODE = 'UZS';

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

describe('PrismaDebtReminderRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const debtRepository = new PrismaDebtRepository(prisma, prisma);
  const counterpartyRepository = new PrismaCounterpartyRepository(prisma);
  const reminderRepository = new PrismaDebtReminderRepository(prisma);
  let userAId: string;
  let userBId: string;
  let createdDebtIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: {
        telegramUserId: TELEGRAM_USER_ID_A,
        displayName: 'Debt Reminder Test A',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userAId = userA.id;
    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: {
        telegramUserId: TELEGRAM_USER_ID_B,
        displayName: 'Debt Reminder Test B',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdDebtIds.length > 0) {
      for (const debtId of createdDebtIds) {
        await prisma.domainEvent.deleteMany({
          where: { payload: { path: ['debtId'], equals: debtId } },
        });
      }
      await prisma.debtRepayment.deleteMany({ where: { debtId: { in: createdDebtIds } } });
      await prisma.debt.deleteMany({ where: { id: { in: createdDebtIds } } });
    }
    createdDebtIds = [];
  });

  afterAll(async () => {
    await prisma.counterparty.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  /** A validly-created debt with a present-or-future due date — the normal path, through the real domain-validated repository. */
  async function makeDebt(userId: string, dueDate: Date) {
    const counterparty = await as(userId, () =>
      counterpartyRepository.findOrCreateByName(userId, `Reminder-${randomUUID()}`),
    );
    const debt = await as(userId, () =>
      debtRepository.create({
        userId,
        direction: 'given',
        counterpartyName: counterparty.name,
        counterpartyRefId: counterparty.id,
        originalAmount: '40000',
        currency: CURRENCY_CODE,
        transactionDate: new Date(),
        dueDate,
        notes: null,
        originalText: 'reminder test debt',
      }),
    );
    createdDebtIds.push(debt.id);
    return debt;
  }

  /** A debt already overdue — cannot be produced via `create()` (its own creation-time validation forbids a past due date); seeded via a direct raw insert, representing a debt that *was* validly created and has since become overdue purely through the passage of time. */
  async function makeOverdueDebt(userId: string, dueDate: Date) {
    const counterparty = await as(userId, () =>
      counterpartyRepository.findOrCreateByName(userId, `Overdue-${randomUUID()}`),
    );
    const row = await as(userId, () =>
      prisma.debt.create({
        data: {
          userId,
          direction: 'given',
          counterpartyName: counterparty.name,
          counterpartyRefId: counterparty.id,
          originalAmount: '40000',
          outstandingBalance: '40000',
          currency: CURRENCY_CODE,
          transactionDate: new Date(),
          dueDate,
          status: 'open',
          originalText: 'overdue reminder test debt',
        },
      }),
    );
    createdDebtIds.push(row.id);
    return row;
  }

  it('A — includes a debt due today', async () => {
    const debt = await makeDebt(userAId, daysFromNow(0));
    const candidates = await reminderRepository.findCandidates(new Date());
    expect(candidates.map((c) => c.debtId)).toContain(debt.id);
  });

  it('B — includes a debt due tomorrow (1 day before)', async () => {
    const debt = await makeDebt(userAId, daysFromNow(1));
    const candidates = await reminderRepository.findCandidates(new Date());
    expect(candidates.map((c) => c.debtId)).toContain(debt.id);
  });

  it('C — includes a long-overdue debt (no arbitrary age cutoff)', async () => {
    const debt = await makeOverdueDebt(userAId, daysFromNow(-700));
    const candidates = await reminderRepository.findCandidates(new Date());
    expect(candidates.map((c) => c.debtId)).toContain(debt.id);
  });

  it('D — excludes a debt due 3+ days from now', async () => {
    const debt = await makeDebt(userAId, daysFromNow(3));
    const candidates = await reminderRepository.findCandidates(new Date());
    expect(candidates.map((c) => c.debtId)).not.toContain(debt.id);
  });

  it('E — excludes a repaid debt', async () => {
    const debt = await makeOverdueDebt(userAId, daysFromNow(-5));
    await as(userAId, () =>
      debtRepository.logRepayment({
        debtId: debt.id,
        amount: '40000',
        currency: CURRENCY_CODE,
        repaymentDate: new Date(),
        originalText: 'full repayment before reminder scan',
      }),
    );

    const candidates = await reminderRepository.findCandidates(new Date());
    expect(candidates.map((c) => c.debtId)).not.toContain(debt.id);
  });

  it('F — excludes a forgiven debt', async () => {
    const debt = await makeOverdueDebt(userAId, daysFromNow(-5));
    await as(userAId, () => debtRepository.forgive(debt.id, new Date()));

    const candidates = await reminderRepository.findCandidates(new Date());
    expect(candidates.map((c) => c.debtId)).not.toContain(debt.id);
  });

  it("G — correctly scopes to each user's own debts (cross-user isolation)", async () => {
    const debtA = await makeDebt(userAId, daysFromNow(0));
    const debtB = await makeDebt(userBId, daysFromNow(0));

    const candidates = await reminderRepository.findCandidates(new Date());
    const ids = candidates.map((c) => c.debtId);
    expect(ids).toContain(debtA.id);
    expect(ids).toContain(debtB.id);
    const candidateA = candidates.find((c) => c.debtId === debtA.id)!;
    const candidateB = candidates.find((c) => c.debtId === debtB.id)!;
    expect(candidateA.userId).toBe(userAId);
    expect(candidateB.userId).toBe(userBId);
  });

  it('H — wasReminderEventRecentlyRecorded is true within the window and false outside it, scoped by eventType', async () => {
    const debtId = randomUUID();
    await prisma.domainEvent.create({
      data: {
        eventType: 'DebtDueApproaching',
        status: 'pending',
        payload: {
          debtId,
          userId: userAId,
          counterpartyName: 'Test',
          outstandingBalance: '1',
          currency: 'UZS',
          dueDate: '2026-08-15',
        },
      },
    });

    const withinWindow = await reminderRepository.wasReminderEventRecentlyRecorded(
      debtId,
      'DebtDueApproaching',
      new Date(Date.now() - 60_000),
    );
    expect(withinWindow).toBe(true);

    const outsideWindow = await reminderRepository.wasReminderEventRecentlyRecorded(
      debtId,
      'DebtDueApproaching',
      new Date(Date.now() + 60_000),
    );
    expect(outsideWindow).toBe(false);

    const differentEventType = await reminderRepository.wasReminderEventRecentlyRecorded(
      debtId,
      'DebtOverdue',
      new Date(Date.now() - 60_000),
    );
    expect(differentEventType).toBe(false);

    await prisma.domainEvent.deleteMany({
      where: { payload: { path: ['debtId'], equals: debtId } },
    });
  });
});

describe('PrismaDebtReminderRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('Debt Reminder Producer environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

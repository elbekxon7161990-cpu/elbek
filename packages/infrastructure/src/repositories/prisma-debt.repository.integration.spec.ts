import { randomUUID } from 'node:crypto';
import { InvalidDebtError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaCounterpartyRepository } from './prisma-counterparty.repository';
import { PrismaDebtRepository } from './prisma-debt.repository';

/**
 * TASK-FIN-002 — real-Postgres proof for `PrismaDebtRepository`/
 * `PrismaCounterpartyRepository`: create/retrieve, the atomic-validation
 * lesson (reject before any write), the coupled `logRepayment` write pair
 * (`DebtRepayment` insert + `Debt` balance/status update, both-or-neither),
 * BR-DBT-001's overpayment guard under real concurrency, and `forgive`'s
 * own atomic conditional transition.
 *
 * Owner-role connection (`DIRECT_URL ?? DATABASE_URL`), matching every
 * newer real-Postgres suite in this package. `Debt`/`Counterparty` are both
 * RLS-protected (`rls-protected-models.ts`), and every method on both
 * repositories except `PrismaDebtRepository.logRepayment` (which uses
 * `PRISMA_BASE_CLIENT` with its own manual, non-throwing `getCurrentUserId`
 * check, mirroring `PrismaTransactionRepository.create()`) goes through the
 * RLS-extended client — `rls-context.extension.ts`'s own
 * `requireCurrentUserId()` throws `MissingDatabaseUserContextError` for ANY
 * RLS-protected-model operation with no active AsyncLocalStorage context,
 * REGARDLESS of which Postgres role is actually connected (it is a
 * client-side check, before any SQL is even issued) — so every repository
 * call below runs inside `runWithUserContext`, not only the ones this
 * task's own atomic-write methods manually gate. (This is also why
 * `prisma-expense-history.repository.integration.spec.ts` is one of this
 * package's documented pre-existing gaps — it calls an RLS-protected-model
 * method with no such wrapping at all; this file deliberately does not
 * repeat that mistake.)
 *
 * "Counterparty isolation" here means the repository's own explicit
 * `userId` query-scoping is correct (defense-in-depth on top of RLS) — REAL
 * RLS-*policy* enforcement itself is `rls-user-context.integration.spec.ts`'s
 * own dedicated, separately-gated suite (it documents needing a real
 * `app_user` password this environment may not have); this file does not
 * re-test that, following this package's established convention.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_930n;
const TELEGRAM_USER_ID_B = 900_000_000_931n;
const CURRENCY_CODE = 'UZS';

describe('PrismaDebtRepository / PrismaCounterpartyRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const debtRepository = new PrismaDebtRepository(prisma, prisma);
  const counterpartyRepository = new PrismaCounterpartyRepository(prisma);
  let userAId: string;
  let userBId: string;
  let createdDebtIds: string[] = [];
  let createdCounterpartyNames: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'TASK-FIN-002 Test A' },
      update: {},
    });
    userAId = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'TASK-FIN-002 Test B' },
      update: {},
    });
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdDebtIds.length > 0) {
      for (const debtId of createdDebtIds) {
        await prisma.domainEvent.deleteMany({
          where: { eventType: 'DebtSettled', payload: { path: ['debtId'], equals: debtId } },
        });
      }
      await prisma.debtRepayment.deleteMany({ where: { debtId: { in: createdDebtIds } } });
      await prisma.debt.deleteMany({ where: { id: { in: createdDebtIds } } });
    }
    createdDebtIds = [];
    if (createdCounterpartyNames.length > 0) {
      await prisma.counterparty.deleteMany({
        where: { userId: { in: [userAId, userBId] }, name: { in: createdCounterpartyNames } },
      });
    }
    createdCounterpartyNames = [];
  });

  afterAll(async () => {
    await prisma.debtRepayment.deleteMany({
      where: { debt: { userId: { in: [userAId, userBId] } } },
    });
    await prisma.debt.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.counterparty.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeCounterparty(userId: string, name: string) {
    createdCounterpartyNames.push(name);
    return as(userId, () => counterpartyRepository.findOrCreateByName(userId, name));
  }

  async function makeOpenDebt(
    userId: string,
    counterpartyRefId: string,
    counterpartyName: string,
    overrides: Partial<{ originalAmount: string; direction: 'given' | 'received' }> = {},
  ) {
    const debt = await as(userId, () =>
      debtRepository.create({
        userId,
        direction: overrides.direction ?? 'given',
        counterpartyName,
        counterpartyRefId,
        originalAmount: overrides.originalAmount ?? '100000',
        currency: CURRENCY_CODE,
        transactionDate: new Date('2026-08-01'),
        dueDate: new Date('2026-09-01'),
        notes: null,
        originalText: `test debt ${randomUUID()}`,
      }),
    );
    createdDebtIds.push(debt.id);
    return debt;
  }

  it('A — create() persists a debt with outstandingBalance = originalAmount and status = open', async () => {
    const counterparty = await makeCounterparty(userAId, `Aziz-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '75000',
    });

    expect(debt.outstandingBalance).toBe('75000.00');
    expect(debt.status).toBe('open');

    const found = await as(userAId, () => debtRepository.findById(debt.id));
    expect(found?.id).toBe(debt.id);
    expect(found?.outstandingBalance).toBe('75000.00');
  });

  it('B — create() rejects a due date already in the past, with ZERO rows persisted (the atomic-validation lesson)', async () => {
    const counterparty = await makeCounterparty(userAId, `PastDue-${randomUUID()}`);
    const originalText = `past-due-reject-${randomUUID()}`;

    await expect(
      as(userAId, () =>
        debtRepository.create({
          userId: userAId,
          direction: 'given',
          counterpartyName: counterparty.name,
          counterpartyRefId: counterparty.id,
          originalAmount: '50000',
          currency: CURRENCY_CODE,
          transactionDate: new Date('2026-08-01'),
          dueDate: new Date('2020-01-01'), // long in the past
          notes: null,
          originalText,
        }),
      ),
    ).rejects.toThrow(InvalidDebtError);

    const rows = await prisma.debt.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it("C — findOpenByUserId excludes another user's debts and sorts by due date ascending", async () => {
    const counterpartyA = await makeCounterparty(userAId, `Sorted-${randomUUID()}`);
    const counterpartyB = await makeCounterparty(userBId, `Other-${randomUUID()}`);

    const later = await as(userAId, () =>
      debtRepository.create({
        userId: userAId,
        direction: 'given',
        counterpartyName: counterpartyA.name,
        counterpartyRefId: counterpartyA.id,
        originalAmount: '10000',
        currency: CURRENCY_CODE,
        transactionDate: new Date('2026-08-01'),
        dueDate: new Date('2026-12-01'),
        notes: null,
        originalText: `later-${randomUUID()}`,
      }),
    );
    createdDebtIds.push(later.id);

    const sooner = await as(userAId, () =>
      debtRepository.create({
        userId: userAId,
        direction: 'given',
        counterpartyName: counterpartyA.name,
        counterpartyRefId: counterpartyA.id,
        originalAmount: '20000',
        currency: CURRENCY_CODE,
        transactionDate: new Date('2026-08-01'),
        dueDate: new Date('2026-09-01'),
        notes: null,
        originalText: `sooner-${randomUUID()}`,
      }),
    );
    createdDebtIds.push(sooner.id);

    const otherUsersDebt = await makeOpenDebt(userBId, counterpartyB.id, counterpartyB.name);

    const openForA = await as(userAId, () => debtRepository.findOpenByUserId(userAId));
    const ids = openForA.map((d) => d.id);

    expect(ids).toContain(sooner.id);
    expect(ids).toContain(later.id);
    expect(ids).not.toContain(otherUsersDebt.id);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));
  });

  it('D — findOpenByCounterparty filters by direction (a "given" debt is not returned for direction "received")', async () => {
    const counterparty = await makeCounterparty(userAId, `Directional-${randomUUID()}`);
    const givenDebt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      direction: 'given',
    });

    const matchesGiven = await as(userAId, () =>
      debtRepository.findOpenByCounterparty(userAId, counterparty.id, 'given'),
    );
    const matchesReceived = await as(userAId, () =>
      debtRepository.findOpenByCounterparty(userAId, counterparty.id, 'received'),
    );

    expect(matchesGiven.map((d) => d.id)).toContain(givenDebt.id);
    expect(matchesReceived.map((d) => d.id)).not.toContain(givenDebt.id);
  });

  it('E — logRepayment inserts a DebtRepayment row and atomically decrements the outstanding balance (partial repayment)', async () => {
    const counterparty = await makeCounterparty(userAId, `Partial-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '100000',
    });

    const result = await as(userAId, () =>
      debtRepository.logRepayment({
        debtId: debt.id,
        amount: '30000',
        currency: CURRENCY_CODE,
        repaymentDate: new Date('2026-08-15'),
        originalText: 'partial repayment',
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.debt.outstandingBalance).toBe('70000.00');
    expect(result?.debt.status).toBe('open');
    expect(result?.repayment.amount).toBe('30000.00');
    expect(result?.repayment.debtId).toBe(debt.id);

    const repaymentRows = await prisma.debtRepayment.findMany({ where: { debtId: debt.id } });
    expect(repaymentRows).toHaveLength(1);
  });

  it('F — logRepayment transitions status to "repaid" on an exact full repayment', async () => {
    const counterparty = await makeCounterparty(userAId, `Full-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '40000',
    });

    const result = await as(userAId, () =>
      debtRepository.logRepayment({
        debtId: debt.id,
        amount: '40000',
        currency: CURRENCY_CODE,
        repaymentDate: new Date('2026-08-15'),
        originalText: 'full repayment',
      }),
    );

    expect(result?.debt.outstandingBalance).toBe('0.00');
    expect(result?.debt.status).toBe('repaid');
  });

  it('G — logRepayment returns null and persists nothing when the amount would overpay the debt (the atomic conditional guard)', async () => {
    const counterparty = await makeCounterparty(userAId, `Overpay-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '40000',
    });

    const result = await as(userAId, () =>
      debtRepository.logRepayment({
        debtId: debt.id,
        amount: '50000', // exceeds the 40000 outstanding balance
        currency: CURRENCY_CODE,
        repaymentDate: new Date('2026-08-15'),
        originalText: 'overpay attempt',
      }),
    );

    expect(result).toBeNull();

    const unchanged = await as(userAId, () => debtRepository.findById(debt.id));
    expect(unchanged?.outstandingBalance).toBe('40000.00');
    expect(unchanged?.status).toBe('open');

    const repaymentRows = await prisma.debtRepayment.findMany({ where: { debtId: debt.id } });
    expect(repaymentRows).toHaveLength(0);
  });

  it('H — concurrent repayments together exceeding the outstanding balance: only what fits lands, the loser is safely rejected (TOCTOU-safe)', async () => {
    const counterparty = await makeCounterparty(userAId, `Concurrent-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '50000',
    });

    // Two concurrent 30000 repayments against a 50000 balance: only one can
    // land (30000 <= 50000); the second must see a balance that no longer
    // supports it (50000 - 30000 = 20000 < 30000) and be safely rejected —
    // never allowed to drive the balance negative.
    const [first, second] = await Promise.all([
      as(userAId, () =>
        debtRepository.logRepayment({
          debtId: debt.id,
          amount: '30000',
          currency: CURRENCY_CODE,
          repaymentDate: new Date('2026-08-15'),
          originalText: 'concurrent A',
        }),
      ),
      as(userAId, () =>
        debtRepository.logRepayment({
          debtId: debt.id,
          amount: '30000',
          currency: CURRENCY_CODE,
          repaymentDate: new Date('2026-08-15'),
          originalText: 'concurrent B',
        }),
      ),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((o) => o !== null);
    const rejected = outcomes.filter((o) => o === null);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalDebt = await as(userAId, () => debtRepository.findById(debt.id));
    // Never negative — the core BR-DBT-001 guarantee this test exists to prove.
    expect(finalDebt?.outstandingBalance).toBe('20000.00');

    const repaymentRows = await prisma.debtRepayment.findMany({ where: { debtId: debt.id } });
    expect(repaymentRows).toHaveLength(1);
  });

  it('I — forgive() transitions an open debt to "forgiven"', async () => {
    const counterparty = await makeCounterparty(userAId, `Forgive-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '25000',
    });

    const forgiven = await as(userAId, () => debtRepository.forgive(debt.id, new Date()));
    expect(forgiven?.status).toBe('forgiven');
    expect(forgiven?.outstandingBalance).toBe('25000.00');
  });

  it('J — forgive() returns null for a debt that is no longer open', async () => {
    const counterparty = await makeCounterparty(userAId, `AlreadyForgiven-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '15000',
    });

    const firstForgive = await as(userAId, () => debtRepository.forgive(debt.id, new Date()));
    expect(firstForgive?.status).toBe('forgiven');

    const secondForgive = await as(userAId, () => debtRepository.forgive(debt.id, new Date()));
    expect(secondForgive).toBeNull();
  });

  it('J2 — Debt Reminder Producer task: logRepayment() reaching a full repayment emits a real DebtSettled event (status="repaid") in the SAME transaction', async () => {
    const counterparty = await makeCounterparty(userAId, `Settled-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '30000',
    });

    await as(userAId, () =>
      debtRepository.logRepayment({
        debtId: debt.id,
        amount: '30000',
        currency: CURRENCY_CODE,
        repaymentDate: new Date('2026-08-15'),
        originalText: 'full repayment settles the debt',
      }),
    );

    const events = await prisma.domainEvent.findMany({
      where: { eventType: 'DebtSettled', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      debtId: debt.id,
      userId: userAId,
      counterpartyName: counterparty.name,
      status: 'repaid',
    });
    expect(events[0]!.status).toBe('pending');
  });

  it('J3 — a PARTIAL repayment (debt stays open) does NOT emit a DebtSettled event', async () => {
    const counterparty = await makeCounterparty(userAId, `Partial-Settle-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '30000',
    });

    await as(userAId, () =>
      debtRepository.logRepayment({
        debtId: debt.id,
        amount: '10000',
        currency: CURRENCY_CODE,
        repaymentDate: new Date('2026-08-15'),
        originalText: 'partial repayment',
      }),
    );

    const events = await prisma.domainEvent.findMany({
      where: { eventType: 'DebtSettled', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(events).toHaveLength(0);
  });

  it('J4 — forgive() emits a real DebtSettled event (status="forgiven") in the SAME transaction', async () => {
    const counterparty = await makeCounterparty(userAId, `ForgiveSettled-${randomUUID()}`);
    const debt = await makeOpenDebt(userAId, counterparty.id, counterparty.name, {
      originalAmount: '20000',
    });

    await as(userAId, () => debtRepository.forgive(debt.id, new Date()));

    const events = await prisma.domainEvent.findMany({
      where: { eventType: 'DebtSettled', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      debtId: debt.id,
      userId: userAId,
      counterpartyName: counterparty.name,
      status: 'forgiven',
    });
  });

  it('K — Counterparty.findOrCreateByName is idempotent (same user, same name -> same row, never a duplicate)', async () => {
    const name = `Idempotent-${randomUUID()}`;
    createdCounterpartyNames.push(name);

    const first = await as(userAId, () => counterpartyRepository.findOrCreateByName(userAId, name));
    const second = await as(userAId, () =>
      counterpartyRepository.findOrCreateByName(userAId, name),
    );

    expect(second.id).toBe(first.id);

    const rows = await prisma.counterparty.findMany({ where: { userId: userAId, name } });
    expect(rows).toHaveLength(1);
  });

  it('L — Counterparty.findOrCreateByName is race-safe: concurrent calls for the same new name never violate the UNIQUE(user_id, name) constraint', async () => {
    const name = `Race-${randomUUID()}`;
    createdCounterpartyNames.push(name);

    const [first, second] = await Promise.all([
      as(userAId, () => counterpartyRepository.findOrCreateByName(userAId, name)),
      as(userAId, () => counterpartyRepository.findOrCreateByName(userAId, name)),
    ]);

    expect(second.id).toBe(first.id);

    const rows = await prisma.counterparty.findMany({ where: { userId: userAId, name } });
    expect(rows).toHaveLength(1);
  });

  it("M — Counterparty.findAllByUserId excludes another user's counterparties (query-scoping correctness)", async () => {
    const nameA = `ScopedA-${randomUUID()}`;
    const nameB = `ScopedB-${randomUUID()}`;
    await makeCounterparty(userAId, nameA);
    await makeCounterparty(userBId, nameB);

    const forA = await as(userAId, () => counterpartyRepository.findAllByUserId(userAId));
    expect(forA.some((c) => c.name === nameA)).toBe(true);
    expect(forA.some((c) => c.name === nameB)).toBe(false);
  });
});

describe('PrismaDebtRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-002 debt-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { computeLoanAmortization, InvalidLoanError, installmentsPerYearFor } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { formatDecimalAmount } from './format-decimal-amount';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaLoanRepository } from './prisma-loan.repository';

/**
 * TASK-FIN-004 (Stage B) — real-Postgres proof for `PrismaLoanRepository`:
 * create/retrieve, the atomic-validation lesson (reject before any write),
 * `findOpenByUserId`'s open/paid_off/soft-deleted filtering, and ownership
 * isolation. Owner-role connection (`DIRECT_URL ?? DATABASE_URL`), matching
 * every real-Postgres suite in this package (`prisma-debt.repository.integration.spec.ts`'s
 * own established convention). `Loan` is RLS-protected
 * (`rls-protected-models.ts`); every call runs inside `runWithUserContext`.
 *
 * TASK-FIN-004 Stage F adds a second describe block below for
 * `logPayment` — real-Postgres proof of the three approved product
 * decisions (OVERPAYMENT = REJECT, PARTIAL/IRREGULAR PAYMENTS = ALLOWED,
 * NEGATIVE AMORTIZATION = REJECT), the `paid_off` transition, frozen
 * `principal_portion` persistence, and concurrency safety.
 *
 * Stage F review checkpoint correction: `interestRate` fixtures throughout
 * this file use the decimal-fraction convention (e.g. `"0.1200"` for 12%),
 * matching §13.20.3's `NUMERIC(6,4)` column documentation — not the
 * whole-number-percentage convention (`"12.00"`) an earlier Stage F
 * implementation incorrectly used.
 *

 * "Ownership isolation" here means `findOpenByUserId`'s own explicit
 * `WHERE userId = ...` query-scoping is correct (defense-in-depth on top of
 * RLS) — REAL RLS-*policy* enforcement is `rls-user-context.integration.spec.ts`'s
 * own dedicated, separately-gated suite (Postgres's row-level security is
 * bypassed for the table-owner role this suite connects as, so it cannot
 * itself prove real cross-tenant blocking). `findById(id)` — mirroring
 * `AccountRepository`/`DebtRepository`'s identical no-`userId`-parameter
 * signature — is therefore deliberately NOT tested for cross-user rejection
 * here, exactly following `prisma-debt.repository.integration.spec.ts`'s
 * own established precedent and its own identical documented reasoning.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_940n;
const TELEGRAM_USER_ID_B = 900_000_000_941n;
const CURRENCY_CODE = 'UZS';

describe('PrismaLoanRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const loanRepository = new PrismaLoanRepository(prisma, prisma);
  let userAId: string;
  let userBId: string;
  let createdLoanIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: { telegramUserId: TELEGRAM_USER_ID_A, displayName: 'TASK-FIN-004 Loan Test A' },
      update: {},
    });
    userAId = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: { telegramUserId: TELEGRAM_USER_ID_B, displayName: 'TASK-FIN-004 Loan Test B' },
      update: {},
    });
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdLoanIds.length > 0) {
      await prisma.loanPayment.deleteMany({ where: { loanId: { in: createdLoanIds } } });
      await prisma.loan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    createdLoanIds = [];
  });

  afterAll(async () => {
    await prisma.loanPayment.deleteMany({
      where: { loan: { userId: { in: [userAId, userBId] } } },
    });
    await prisma.loan.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeLoan(
    userId: string,
    overrides: Partial<Parameters<typeof loanRepository.create>[0]> = {},
  ) {
    const loan = await as(userId, () =>
      loanRepository.create({
        userId,
        lender: 'Ipoteka Bank',
        principalAmount: '1000000.00',
        currency: CURRENCY_CODE,
        interestRate: '0.1200',
        installmentAmount: '90000.00',
        installmentFrequency: 'monthly',
        startDate: new Date('2026-08-01'),
        ...overrides,
      }),
    );
    createdLoanIds.push(loan.id);
    return loan;
  }

  it('A — create() persists a loan with outstandingBalance = principalAmount and status = open', async () => {
    const loan = await makeLoan(userAId, { principalAmount: '750000.00' });

    expect(loan.outstandingBalance).toBe('750000.00');
    expect(loan.status).toBe('open');
    expect(loan.lender).toBe('Ipoteka Bank');

    const found = await as(userAId, () => loanRepository.findById(loan.id));
    expect(found?.id).toBe(loan.id);
    expect(found?.outstandingBalance).toBe('750000.00');
  });

  it('B — create() persists an interest-free loan (null interestRate, FR-FIN-007)', async () => {
    const loan = await makeLoan(userAId, { interestRate: null });
    expect(loan.interestRate).toBeNull();
  });

  it('C — create() rejects a non-positive principalAmount, with ZERO rows persisted (the atomic-validation lesson)', async () => {
    const lender = `RejectTest-${randomUUID()}`;

    await expect(
      as(userAId, () =>
        loanRepository.create({
          userId: userAId,
          lender,
          principalAmount: '0',
          currency: CURRENCY_CODE,
          interestRate: null,
          installmentAmount: '10000.00',
          installmentFrequency: 'monthly',
          startDate: new Date('2026-08-01'),
        }),
      ),
    ).rejects.toThrow(InvalidLoanError);

    const rows = await prisma.loan.findMany({ where: { lender } });
    expect(rows).toHaveLength(0);
  });

  it("D — findOpenByUserId excludes another user's loans", async () => {
    const mine = await makeLoan(userAId);
    const theirs = await makeLoan(userBId);

    const openForA = await as(userAId, () => loanRepository.findOpenByUserId(userAId));
    const ids = openForA.map((l) => l.id);

    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it('E — findOpenByUserId excludes a "paid_off" loan (archived/closed filtering)', async () => {
    const openLoan = await makeLoan(userAId);
    const paidOffLoan = await makeLoan(userAId, { principalAmount: '200000.00' });
    // Stage B builds no payment-application method (deliberately deferred to
    // Stage E) — this fixture reaches the "paid_off" state via a direct
    // write, bypassing repository/domain logic entirely, purely to prove
    // the LIST FILTER excludes it, not to exercise any payment behavior.
    await prisma.loan.update({
      where: { id: paidOffLoan.id },
      data: { status: 'paid_off', outstandingBalance: '0.00' },
    });

    const openForA = await as(userAId, () => loanRepository.findOpenByUserId(userAId));
    const ids = openForA.map((l) => l.id);

    expect(ids).toContain(openLoan.id);
    expect(ids).not.toContain(paidOffLoan.id);
  });

  it('F — findOpenByUserId excludes a soft-deleted loan (defense-in-depth; no current use case sets deletedAt)', async () => {
    const loan = await makeLoan(userAId);
    await prisma.loan.update({ where: { id: loan.id }, data: { deletedAt: new Date() } });

    const openForA = await as(userAId, () => loanRepository.findOpenByUserId(userAId));
    expect(openForA.map((l) => l.id)).not.toContain(loan.id);
  });

  it('G — preserves decimal precision through a full round trip (DB-P3/FR-DB-027)', async () => {
    const loan = await makeLoan(userAId, {
      principalAmount: '123456789012.34',
      installmentAmount: '5000000.99',
    });

    const found = await as(userAId, () => loanRepository.findById(loan.id));
    expect(found?.principalAmount).toBe('123456789012.34');
    expect(found?.installmentAmount).toBe('5000000.99');
  });
});

describe('PrismaLoanRepository.logPayment() — TASK-FIN-004 Stage F, §8.14.6 (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const loanRepository = new PrismaLoanRepository(prisma, prisma);
  const TELEGRAM_USER_ID_C = 900_000_000_961n;
  let userCId: string;
  let createdLoanIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userCId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userC = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_C },
      create: {
        telegramUserId: TELEGRAM_USER_ID_C,
        displayName: 'TASK-FIN-004 Stage F Loan Payment Test',
      },
      update: {},
    });
    userCId = userC.id;
  });

  afterEach(async () => {
    if (createdLoanIds.length > 0) {
      await prisma.loanPayment.deleteMany({ where: { loanId: { in: createdLoanIds } } });
      await prisma.loan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    createdLoanIds = [];
  });

  afterAll(async () => {
    await prisma.loanPayment.deleteMany({ where: { loan: { userId: userCId } } });
    await prisma.loan.deleteMany({ where: { userId: userCId } });
    await prisma.user.deleteMany({ where: { id: userCId } });
    await prisma.onModuleDestroy();
  });

  async function makeLoan(overrides: Partial<Parameters<typeof loanRepository.create>[0]> = {}) {
    const loan = await as(() =>
      loanRepository.create({
        userId: userCId,
        lender: 'Ipoteka Bank',
        principalAmount: '1000000.00',
        currency: CURRENCY_CODE,
        interestRate: null,
        installmentAmount: '90000.00',
        installmentFrequency: 'monthly',
        startDate: new Date('2026-08-01'),
        ...overrides,
      }),
    );
    createdLoanIds.push(loan.id);
    return loan;
  }

  it('A — interest-free: principal_portion equals the full payment, balance decreases by exactly that amount', async () => {
    const loan = await makeLoan();

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '90000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.payment.principalPortion).toBe('90000.00');
    expect(result!.loan.outstandingBalance).toBe('910000.00');
    expect(result!.loan.status).toBe('open');
  });

  it('B — interest-bearing: reproduces AC-FIN-003’s own worked numbers (principal_portion < full payment)', async () => {
    const loan = await makeLoan({ interestRate: '0.1200' });

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '90000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    // interest due = 1,000,000 * 0.12 / 12 = 10,000.00
    expect(result!.payment.principalPortion).toBe('80000.00');
    expect(result!.loan.outstandingBalance).toBe('920000.00');
  });

  it('C — PARTIAL/IRREGULAR PAYMENTS = ALLOWED: a payment far below installmentAmount is accepted', async () => {
    const loan = await makeLoan();

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '500.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.loan.outstandingBalance).toBe('999500.00');
  });

  it('D — a payment exactly equal to outstandingBalance reaches zero AND transitions status to "paid_off" (preserves the existing invariant)', async () => {
    const loan = await makeLoan({ principalAmount: '50000.00' });

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '50000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result!.loan.outstandingBalance).toBe('0.00');
    expect(result!.loan.status).toBe('paid_off');
  });

  it('E — OVERPAYMENT = REJECT: returns null, ZERO rows persisted, loan unchanged (the atomic-conditional-guard backstop)', async () => {
    const loan = await makeLoan({ principalAmount: '50000.00' });

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '50000.01',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result).toBeNull();

    const unchanged = await as(() => loanRepository.findById(loan.id));
    expect(unchanged?.outstandingBalance).toBe('50000.00');
    expect(unchanged?.status).toBe('open');

    const paymentRows = await prisma.loanPayment.findMany({ where: { loanId: loan.id } });
    expect(paymentRows).toHaveLength(0);
  });

  it('F — NEGATIVE AMORTIZATION = REJECT: returns null, ZERO rows persisted, loan unchanged', async () => {
    const loan = await makeLoan({ interestRate: '0.1200' });

    // interest due = 1,000,000 * 0.12 / 12 = 10,000.00; 500 doesn't cover it.
    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '500.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result).toBeNull();

    const unchanged = await as(() => loanRepository.findById(loan.id));
    expect(unchanged?.outstandingBalance).toBe('1000000.00');

    const paymentRows = await prisma.loanPayment.findMany({ where: { loanId: loan.id } });
    expect(paymentRows).toHaveLength(0);
  });

  it('G — a payment exactly equal to the interest due (principal_portion = 0.00) is accepted, persisted, and does NOT change the balance', async () => {
    const loan = await makeLoan({ interestRate: '0.1200' });

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '10000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.payment.principalPortion).toBe('0.00');
    expect(result!.loan.outstandingBalance).toBe('1000000.00');
    expect(result!.loan.status).toBe('open');
  });

  it('H — returns null for a non-existent loan', async () => {
    const result = await as(() =>
      loanRepository.logPayment({
        loanId: randomUUID(),
        amount: '1000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );
    expect(result).toBeNull();
  });

  it('I — returns null for an already-"paid_off" loan (a second payment attempt after payoff)', async () => {
    const loan = await makeLoan({ principalAmount: '50000.00' });
    const first = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '50000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );
    expect(first!.loan.status).toBe('paid_off');

    const second = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '100.00',
        paymentDate: new Date('2026-08-19'),
      }),
    );
    expect(second).toBeNull();
  });

  it('J — principal_portion is persisted and remains FROZEN after a later payment changes the loan’s balance further (FR-DB-003 — never retroactively recalculated)', async () => {
    const loan = await makeLoan({ interestRate: '0.1200' });

    const firstResult = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '90000.00',
        paymentDate: new Date('2026-08-01'),
      }),
    );
    const firstPrincipalPortion = firstResult!.payment.principalPortion;
    expect(firstPrincipalPortion).toBe('80000.00'); // interest 10,000 on 1,000,000

    // A second payment changes the loan's outstanding balance further —
    // if principal_portion were ever recomputed retroactively, the first
    // payment's own stored value would drift from what it was actually
    // computed as at write time.
    await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '90000.00',
        paymentDate: new Date('2026-09-01'),
      }),
    );

    const paymentRows = await prisma.loanPayment.findMany({
      where: { loanId: loan.id },
      orderBy: { paymentDate: 'asc' },
    });
    expect(paymentRows).toHaveLength(2);
    expect(formatDecimalAmount(paymentRows[0]!.principalPortion)).toBe(firstPrincipalPortion);
  });

  it('K — concurrent payments together exceeding the outstanding balance: only what fits lands, the loser is safely rejected (TOCTOU-safe)', async () => {
    const loan = await makeLoan({ principalAmount: '50000.00' });

    // Two concurrent 30,000 payments against a 50,000 balance: only one can
    // land (30,000 <= 50,000); the second must see a balance that no
    // longer supports it (50,000 - 30,000 = 20,000 < 30,000) and be safely
    // rejected — never allowed to drive the balance negative.
    const [first, second] = await Promise.all([
      as(() =>
        loanRepository.logPayment({
          loanId: loan.id,
          amount: '30000.00',
          paymentDate: new Date('2026-08-18'),
        }),
      ),
      as(() =>
        loanRepository.logPayment({
          loanId: loan.id,
          amount: '30000.00',
          paymentDate: new Date('2026-08-18'),
        }),
      ),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((o) => o !== null)).toHaveLength(1);
    expect(outcomes.filter((o) => o === null)).toHaveLength(1);

    const finalLoan = await as(() => loanRepository.findById(loan.id));
    // Never negative, never double-applied — the core safety guarantee
    // this test exists to prove.
    expect(finalLoan?.outstandingBalance).toBe('20000.00');

    const paymentRows = await prisma.loanPayment.findMany({ where: { loanId: loan.id } });
    expect(paymentRows).toHaveLength(1);
  });

  it('L — the atomic SQL formula (not just the domain pre-check) accepts the full NUMERIC(6,4) precision "0.1235" (12.35%) and computes correctly against a real Postgres row', async () => {
    const loan = await makeLoan({ interestRate: '0.1235' });

    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '90000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    // interest due = 1,000,000 * 0.1235 / 12 = 10,291.666... -> 10,291.67
    expect(result!.payment.principalPortion).toBe('79708.33'); // 90,000 - 10,291.67
  });

  it('M — REGRESSION: the atomic SQL formula does NOT silently reinterpret "12.00" as 12% either — as a raw decimal fraction (1200% annual) it makes the interest due exceed the payment, so the write is rejected (null, zero rows) exactly like the domain pre-check', async () => {
    const loan = await makeLoan({ interestRate: '12.00' });

    // interest due = 1,000,000 * 12 / 12 = 1,000,000.00 — a normal 90,000
    // installment cannot cover it. Under the old (removed) percentage
    // convention this exact setup instead succeeded with principal_portion
    // = 80,000.00 (see test B above).
    const result = await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '90000.00',
        paymentDate: new Date('2026-08-18'),
      }),
    );

    expect(result).toBeNull();

    const paymentRows = await prisma.loanPayment.findMany({ where: { loanId: loan.id } });
    expect(paymentRows).toHaveLength(0);
  });
});

describe('PrismaLoanRepository.logPayment() — TASK-FIN-004 concurrency hardening (FOR NO KEY UPDATE), real Postgres', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const loanRepository = new PrismaLoanRepository(prisma, prisma);
  const TELEGRAM_USER_ID_D = 900_000_000_970n;
  let userDId: string;
  let createdLoanIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userDId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userD = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_D },
      create: {
        telegramUserId: TELEGRAM_USER_ID_D,
        displayName: 'TASK-FIN-004 Loan Concurrency Test',
      },
      update: {},
    });
    userDId = userD.id;
  });

  afterEach(async () => {
    if (createdLoanIds.length > 0) {
      await prisma.loanPayment.deleteMany({ where: { loanId: { in: createdLoanIds } } });
      await prisma.loan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    createdLoanIds = [];
  });

  afterAll(async () => {
    await prisma.loanPayment.deleteMany({ where: { loan: { userId: userDId } } });
    await prisma.loan.deleteMany({ where: { userId: userDId } });
    await prisma.user.deleteMany({ where: { id: userDId } });
    await prisma.onModuleDestroy();
  });

  async function makeLoan(overrides: Partial<Parameters<typeof loanRepository.create>[0]> = {}) {
    const loan = await as(() =>
      loanRepository.create({
        userId: userDId,
        lender: 'Ipoteka Bank',
        principalAmount: '100000.00',
        currency: CURRENCY_CODE,
        interestRate: '0.1200',
        installmentAmount: '20000.00',
        installmentFrequency: 'monthly',
        startDate: new Date('2026-08-01'),
        ...overrides,
      }),
    );
    createdLoanIds.push(loan.id);
    return loan;
  }

  /**
   * Deterministic concurrency control, NOT a bare `Promise.all()`: opens a
   * dedicated, TEST-ONLY transaction that acquires `FOR NO KEY UPDATE` on
   * the loan row FIRST and holds it, then launches both real
   * `loanRepository.logPayment()` calls (which will each immediately block
   * trying to acquire that same lock — guaranteed, since this transaction
   * already holds it), waits long enough to be certain both are genuinely
   * queued and waiting (not just "probably overlapping" under
   * `Promise.all` timing), then commits — releasing the lock and letting
   * the two real calls contend for it exactly as two organically-concurrent
   * `logPayment()` invocations would. This exercises the REAL production
   * code path end to end (not a reimplementation), while removing all
   * reliance on network-timing luck for the overlap itself.
   */
  async function runTwoPaymentsUnderForcedContention(
    loanId: string,
    paymentA: { amount: string; paymentDate: Date },
    paymentB: { amount: string; paymentDate: Date },
  ): Promise<{
    resultA: PromiseSettledResult<Awaited<ReturnType<typeof loanRepository.logPayment>>>;
    resultB: PromiseSettledResult<Awaited<ReturnType<typeof loanRepository.logPayment>>>;
  }> {
    let releaseSyncLock: () => void = () => {};
    const syncLockReleased = new Promise<void>((resolve) => {
      releaseSyncLock = resolve;
    });

    const syncTx = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM loans WHERE id = ${loanId}::uuid FOR NO KEY UPDATE`;
        await syncLockReleased;
      },
      { timeout: 20_000, maxWait: 15_000 },
    );

    // Give the sync transaction time to actually acquire the lock before
    // launching the two real calls.
    await sleep(500);

    const promiseA = as(() => loanRepository.logPayment({ loanId, ...paymentA }));
    const promiseB = as(() => loanRepository.logPayment({ loanId, ...paymentB }));

    // Give both real calls time to reach the database and genuinely queue
    // on the lock the sync transaction is holding.
    await sleep(1000);

    releaseSyncLock();
    await syncTx;

    const [resultA, resultB] = await Promise.allSettled([promiseA, promiseB]);
    return { resultA, resultB };
  }

  it('N — two genuinely concurrent interest-bearing payments: the second-to-apply is computed against the FRESH post-first balance, never the stale pre-wait snapshot', async () => {
    const loan = await makeLoan({ interestRate: '0.1200', principalAmount: '100000.00' });
    const installmentsPerYear = installmentsPerYearFor('monthly');

    const { resultA, resultB } = await runTwoPaymentsUnderForcedContention(
      loan.id,
      { amount: '20000.00', paymentDate: new Date('2026-08-18') },
      { amount: '15000.00', paymentDate: new Date('2026-08-18') },
    );

    expect(resultA.status).toBe('fulfilled');
    expect(resultB.status).toBe('fulfilled');
    const valueA = resultA.status === 'fulfilled' ? resultA.value : null;
    const valueB = resultB.status === 'fulfilled' ? resultB.value : null;
    expect(valueA).not.toBeNull();
    expect(valueB).not.toBeNull();

    const storedPortionA = valueA!.payment.principalPortion;
    const storedPortionB = valueB!.payment.principalPortion;

    // Both mathematically possible serialization orders, computed via the
    // SAME unmodified `computeLoanAmortization` the production code now
    // calls — never a value derived from the stale pre-wait snapshot.
    const portionA_ifFirst = computeLoanAmortization({
      outstandingBalance: '100000.00',
      interestRate: '0.1200',
      installmentsPerYear,
      paymentAmount: '20000.00',
    });
    const portionB_ifFirst = computeLoanAmortization({
      outstandingBalance: '100000.00',
      interestRate: '0.1200',
      installmentsPerYear,
      paymentAmount: '15000.00',
    });

    let expectedFinalBalance: string;
    if (storedPortionA === portionA_ifFirst) {
      // A applied first (against the original 100000) -> B must be computed
      // against the FRESH post-A balance (100000 - portionA_ifFirst), never
      // against the stale original 100000 (which would silently reproduce
      // the confirmed bug: portionB would incorrectly equal portionB_ifFirst).
      const balanceAfterA = (100000 - Number(portionA_ifFirst)).toFixed(2);
      const portionB_ifSecond = computeLoanAmortization({
        outstandingBalance: balanceAfterA,
        interestRate: '0.1200',
        installmentsPerYear,
        paymentAmount: '15000.00',
      });
      expect(storedPortionB).toBe(portionB_ifSecond);
      expect(storedPortionB).not.toBe(portionB_ifFirst);
      expectedFinalBalance = (Number(balanceAfterA) - Number(portionB_ifSecond)).toFixed(2);
    } else {
      // B applied first -> A must reflect the FRESH post-B balance.
      expect(storedPortionB).toBe(portionB_ifFirst);
      const balanceAfterB = (100000 - Number(portionB_ifFirst)).toFixed(2);
      const portionA_ifSecond = computeLoanAmortization({
        outstandingBalance: balanceAfterB,
        interestRate: '0.1200',
        installmentsPerYear,
        paymentAmount: '20000.00',
      });
      expect(storedPortionA).toBe(portionA_ifSecond);
      expect(storedPortionA).not.toBe(portionA_ifFirst);
      expectedFinalBalance = (Number(balanceAfterB) - Number(portionA_ifSecond)).toFixed(2);
    }

    const finalLoan = await as(() => loanRepository.findById(loan.id));
    expect(finalLoan?.outstandingBalance).toBe(expectedFinalBalance);

    const paymentRows = await prisma.loanPayment.findMany({ where: { loanId: loan.id } });
    expect(paymentRows).toHaveLength(2);
  }, 30_000);

  it('O — concurrent overpayment: the loser is gracefully rejected (null) via the application-level guard, never a PostgreSQL CHECK-constraint crash, and the final balance stays valid', async () => {
    const loan = await makeLoan({ interestRate: null, principalAmount: '100000.00' });

    const { resultA, resultB } = await runTwoPaymentsUnderForcedContention(
      loan.id,
      { amount: '90000.00', paymentDate: new Date('2026-08-18') },
      { amount: '95000.00', paymentDate: new Date('2026-08-18') },
    );

    // The core requirement: NEITHER call is allowed to surface a raw
    // PostgreSQL CHECK-constraint error (or any other rejection) — the
    // guard must resolve every genuine contention outcome as a clean
    // `null`, per this repository's own established backstop contract.
    expect(resultA.status).toBe('fulfilled');
    expect(resultB.status).toBe('fulfilled');

    const valueA = resultA.status === 'fulfilled' ? resultA.value : undefined;
    const valueB = resultB.status === 'fulfilled' ? resultB.value : undefined;
    const outcomes = [valueA, valueB];
    expect(outcomes.filter((o) => o !== null)).toHaveLength(1);
    expect(outcomes.filter((o) => o === null)).toHaveLength(1);

    const winner = valueA ?? valueB;
    const winningAmount = valueA !== null ? '90000.00' : '95000.00';
    expect(winner!.payment.principalPortion).toBe(winningAmount);

    const finalLoan = await as(() => loanRepository.findById(loan.id));
    const expectedBalance = (100000 - Number(winningAmount)).toFixed(2);
    expect(finalLoan?.outstandingBalance).toBe(expectedBalance);
    // Never negative — the exact invariant the CHECK constraint would
    // otherwise have to enforce as an unhandled crash.
    expect(Number(finalLoan?.outstandingBalance)).toBeGreaterThanOrEqual(0);

    const paymentRows = await prisma.loanPayment.findMany({ where: { loanId: loan.id } });
    expect(paymentRows).toHaveLength(1);
  }, 30_000);

  it('P — principal_portion computed under genuine concurrency remains FROZEN after a later, third, sequential payment (concurrency hardening does not weaken the existing frozen-at-write guarantee)', async () => {
    const loan = await makeLoan({ interestRate: '0.1200', principalAmount: '100000.00' });

    await runTwoPaymentsUnderForcedContention(
      loan.id,
      { amount: '20000.00', paymentDate: new Date('2026-08-18') },
      { amount: '15000.00', paymentDate: new Date('2026-08-18') },
    );

    const rowsBeforeThird = await prisma.loanPayment.findMany({
      where: { loanId: loan.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rowsBeforeThird).toHaveLength(2);
    const portionsBeforeThird = rowsBeforeThird.map((r) => formatDecimalAmount(r.principalPortion));

    await as(() =>
      loanRepository.logPayment({
        loanId: loan.id,
        amount: '10000.00',
        paymentDate: new Date('2026-09-01'),
      }),
    );

    const rowsAfterThird = await prisma.loanPayment.findMany({
      where: { loanId: loan.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rowsAfterThird).toHaveLength(3);
    const firstTwoPortionsAfterThird = rowsAfterThird
      .slice(0, 2)
      .map((r) => formatDecimalAmount(r.principalPortion));

    expect(firstTwoPortionsAfterThird).toEqual(portionsBeforeThird);
  }, 30_000);
});

describe('PrismaLoanRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-004 loan-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

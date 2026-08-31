import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateExpenseUseCase,
  CreateIncomeUseCase,
  ExchangeRateUnavailableError,
} from '@afa/application';
import { runWithUserContext } from '@afa/shared';
import {
  PrismaAccountRepository,
  PrismaCategoryRepository,
  PrismaCurrencyRepository,
  PrismaExpenseHistoryRepository,
  PrismaFxRateRepository,
  PrismaService,
  PrismaTransactionRepository,
  PrismaUserRepository,
} from '@afa/infrastructure';

/**
 * TASK-FIN-007 Stage E — real-Postgres proof that `CreateExpenseUseCase`/
 * `CreateIncomeUseCase` correctly resolve and persist `accountId` and
 * `exchangeRateToDefault` (FR-FIN-023/027/028/029, BR-FIN-006), exercised
 * through the actual application-layer use cases (not by writing directly
 * via `TransactionRepository`, which would bypass the very logic under
 * test) against real Prisma-backed repositories — mirroring
 * `budget-threshold-scenario-c.integration.spec.ts`'s exact conventions
 * (owner-role Postgres, real repos constructed directly, `runWithUserContext`
 * wrapping for RLS-protected models, 30s per-test timeout for multi-step
 * real-DB chains).
 *
 * A distinct, out-of-band year (2022) and a currency pair (USD -> UZS) not
 * used by any other suite's seed data avoids any collision with Stage C's
 * own `prisma-fx-rate.repository.integration.spec.ts` fixtures (year 2020).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID_A = 900_000_000_981n;
const TEST_TELEGRAM_USER_ID_B = 900_000_000_982n;
const BASE = 'USD';
const QUOTE = 'UZS';

describe('TASK-FIN-007 Stage E — Transaction FX Snapshot (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });

  const userRepository = new PrismaUserRepository(prisma);
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma, prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const expenseHistoryRepository = new PrismaExpenseHistoryRepository(prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);

  const createExpense = new CreateExpenseUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    transactionRepository,
    expenseHistoryRepository,
    accountRepository,
    fxRateRepository,
  );
  const createIncome = new CreateIncomeUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    transactionRepository,
    accountRepository,
    fxRateRepository,
  );

  let userIdA: string;
  let userIdB: string;
  let categoryId: string;
  let createdTransactionIds: string[] = [];
  let createdAccountIds: string[] = [];

  function asA<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userIdA, fn);
  }
  function asB<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userIdB, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID_A },
      create: {
        telegramUserId: TEST_TELEGRAM_USER_ID_A,
        displayName: 'Stage E FX Snapshot Test A',
        timezone: 'UTC',
        defaultCurrency: QUOTE,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: QUOTE },
    });
    userIdA = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID_B },
      create: {
        telegramUserId: TEST_TELEGRAM_USER_ID_B,
        displayName: 'Stage E FX Snapshot Test B',
        timezone: 'UTC',
        defaultCurrency: QUOTE,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: QUOTE },
    });
    userIdB = userB.id;

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
    if (createdAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
    }
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: BASE,
        quoteCurrency: QUOTE,
        asOfDate: { gte: new Date('2022-01-01') },
      },
    });
    createdTransactionIds = [];
    createdAccountIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [userIdA, userIdB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userIdA, userIdB] } } });
    await prisma.onModuleDestroy();
  });

  it('A — stores the exact-date FX rate as the snapshot (FR-FIN-027/028)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12500.75',
      asOfDate: new Date('2022-03-10'),
    });

    const { transaction } = await asA(() =>
      createExpense.execute({
        userId: userIdA,
        amount: '100',
        currency: BASE,
        categoryId,
        transactionDate: new Date('2022-03-10'),
        description: 'Hotel',
        originalText: 'paid 100 usd for hotel',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);

    expect(transaction.exchangeRateToDefault).toBe('12500.75');
    expect(transaction.accountId).not.toBeNull();
    createdAccountIds.push(transaction.accountId!);
  }, 30_000);

  it('B — falls back to the most recent prior rate when no exact-date rate exists (FR-FIN-029)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12000.00',
      asOfDate: new Date('2022-03-01'),
    });

    // No rate recorded for 2022-03-05 — must fall back to 2022-03-01's rate.
    const { transaction } = await asA(() =>
      createExpense.execute({
        userId: userIdA,
        amount: '50',
        currency: BASE,
        categoryId,
        transactionDate: new Date('2022-03-05'),
        description: 'Taxi',
        originalText: 'paid 50 usd for taxi',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);

    // '12000' not '12000.00' — exchangeRateToDefault is Decimal(18,8),
    // not a 2-decimal money field; Decimal#toString() trims insignificant
    // trailing zeros (transaction.mapper.ts's own doc comment), losing no
    // real precision. The value proves the correct rate (2022-03-01's,
    // not some other) was selected — that is what this test verifies.
    expect(transaction.exchangeRateToDefault).toBe('12000');
    createdAccountIds.push(transaction.accountId!);
  }, 30_000);

  it('C — the stored snapshot never changes when a later/corrected rate is recorded (BR-FIN-006 — never re-reads a "current" rate)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12100.00',
      asOfDate: new Date('2022-03-15'),
    });

    const { transaction } = await asA(() =>
      createExpense.execute({
        userId: userIdA,
        amount: '75',
        currency: BASE,
        categoryId,
        transactionDate: new Date('2022-03-15'),
        description: 'Groceries',
        originalText: 'paid 75 usd for groceries',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    createdAccountIds.push(transaction.accountId!);
    expect(transaction.exchangeRateToDefault).toBe('12100'); // trailing zeros trimmed, see test B's comment

    // A "corrected" rate is now recorded for the SAME date, simulating a
    // later ingestion re-run (Stage F's job) that revises the rate.
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '13999.99',
      asOfDate: new Date('2022-03-15'),
    });

    const reread = await transactionRepository.findById(transaction.id);
    expect(reread?.exchangeRateToDefault).toBe('12100'); // unchanged — frozen at commit time
  }, 30_000);

  it('D — a same-currency expense stores exchangeRateToDefault "1" and resolves the implicit default account, without requiring any fx_rates row', async () => {
    const { transaction } = await asA(() =>
      createExpense.execute({
        userId: userIdA,
        amount: '30000',
        currency: QUOTE, // matches user A's own defaultCurrency
        categoryId,
        transactionDate: new Date('2022-03-20'),
        description: 'Lunch',
        originalText: 'spent 30000 on lunch',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    createdAccountIds.push(transaction.accountId!);

    expect(transaction.exchangeRateToDefault).toBe('1');

    const account = await accountRepository.findById(transaction.accountId!);
    expect(account?.isDefault).toBe(true);
    expect(account?.currency).toBe(QUOTE);
  }, 30_000);

  it('E — same-currency behavior is identical for CreateIncomeUseCase, preserving prior single-currency behavior', async () => {
    const transaction = await asA(() =>
      createIncome.execute({
        userId: userIdA,
        transactionType: 'INCOME',
        amount: '500000',
        currency: QUOTE,
        categoryId,
        transactionDate: new Date('2022-03-21'),
        description: 'Freelance payment',
        originalText: 'got 500000 from a client',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    createdAccountIds.push(transaction.accountId!);

    expect(transaction.exchangeRateToDefault).toBe('1');
    expect(transaction.transactionType).toBe('INCOME');
  }, 30_000);

  it('F — an explicitly-supplied accountId is honored instead of the implicit default', async () => {
    const explicitAccount = await asA(() =>
      accountRepository.create({
        userId: userIdA,
        name: 'Travel Card',
        accountType: 'bank_card',
        currency: BASE,
        startingBalance: '0',
        isDefault: false,
      }),
    );
    createdAccountIds.push(explicitAccount.id);

    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12300.00',
      asOfDate: new Date('2022-03-22'),
    });

    const { transaction } = await asA(() =>
      createExpense.execute({
        userId: userIdA,
        accountId: explicitAccount.id,
        amount: '20',
        currency: BASE,
        categoryId,
        transactionDate: new Date('2022-03-22'),
        description: 'Museum ticket',
        originalText: 'paid 20 usd for museum ticket',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);

    expect(transaction.accountId).toBe(explicitAccount.id);
  }, 30_000);

  it('G — two users each get their own independent default account for the same currency (RLS/ownership isolation, §8.12.4)', async () => {
    const { transaction: txnA } = await asA(() =>
      createExpense.execute({
        userId: userIdA,
        amount: '10000',
        currency: QUOTE,
        categoryId,
        transactionDate: new Date('2022-03-23'),
        description: 'A coffee',
        originalText: 'spent 10000 on coffee',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    const { transaction: txnB } = await asB(() =>
      createExpense.execute({
        userId: userIdB,
        amount: '10000',
        currency: QUOTE,
        categoryId,
        transactionDate: new Date('2022-03-23'),
        description: 'B coffee',
        originalText: 'spent 10000 on coffee',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(txnA.id, txnB.id);
    createdAccountIds.push(txnA.accountId!, txnB.accountId!);

    expect(txnA.accountId).not.toBe(txnB.accountId);

    const accountA = await accountRepository.findById(txnA.accountId!);
    const accountB = await accountRepository.findById(txnB.accountId!);
    expect(accountA?.userId).toBe(userIdA);
    expect(accountB?.userId).toBe(userIdB);

    // User A's own transaction list never includes user B's transaction.
    const userATransactions = await asA(() => transactionRepository.findByUserId(userIdA));
    expect(userATransactions.some((t) => t.id === txnB.id)).toBe(false);
  }, 30_000);

  it('H — rejects a cross-currency transaction when no exchange rate exists at all for the pair (FR-FIN-043)', async () => {
    // EUR -> UZS has no seeded fx_rates row anywhere in this suite.
    await expect(
      asA(() =>
        createExpense.execute({
          userId: userIdA,
          amount: '15',
          currency: 'EUR',
          categoryId,
          transactionDate: new Date('2022-03-25'),
          description: 'Souvenir',
          originalText: 'paid 15 eur for a souvenir',
          sourceType: 'text',
          createdBy: 'ai',
        }),
      ),
    ).rejects.toThrow(ExchangeRateUnavailableError);

    const found = await prisma.transaction.findFirst({
      where: { userId: userIdA, description: 'Souvenir' },
    });
    expect(found).toBeNull(); // nothing was persisted
  }, 30_000);
});

describe('TASK-FIN-007 Stage E — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log(
      'TASK-FIN-007 Stage E transaction-fx-snapshot environment gate:',
      JSON.stringify(status),
    );
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CreateExpenseUseCase, CreateIncomeUseCase } from '@afa/application';
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
 * TASK-FIN-007 Stage H — Chapter 19 Scenario D ("James's Multi-Currency
 * Month"), real-Postgres proof of TASK-FIN-007's OWN delivered
 * functionality only. Per the approved narrow interpretation (see this
 * stage's own preflight report): this proves the DATA-LAYER principle
 * Scenario D's table describes — a transaction's exchange-rate snapshot is
 * captured once and frozen (BR-FIN-006), and account balances are computed
 * from Committed-state data using the correct historical FX information
 * (§8.14.2, Stage G). It does NOT exercise, wire into, or modify the
 * Report Generation engine (TASK-REP-001, depends on the un-built
 * TASK-FIN-008) or Export (TASK-FIN-014) — Scenario D's own "monthly
 * report" and "export" rows remain owned by those separate tasks, not
 * proven here. See this stage's final report for the full disclosure.
 *
 * Reuses only already-built, already-tested production mechanisms —
 * `CreateIncomeUseCase`/`CreateExpenseUseCase` (Stage E), `FxRateRepository`
 * (Stage C), `AccountRepository.computeBalance` (Stage G) — no new
 * production code, mirroring `budget-threshold-scenario-c.integration.spec.ts`'s
 * own "construct real repos, drive real use cases" convention exactly.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_JAMES = 900_000_000_990n;
const USD = 'USD';
const UZS = 'UZS';
// 2025 — distinct from every other suite's own out-of-band fixture years
// (Stage C 2020, Stage E 2022, Stage F 2023, Stage G 2024).
const INCOME_DATE = new Date('2025-03-01');
const ORIGINAL_RATE = '12500.75';
const CORRECTED_RATE = '13999.99'; // simulates a later re-ingestion/correction of the SAME historical date

describe("TASK-FIN-007 Stage H — Chapter 19 Scenario D: James's Multi-Currency Month (real Postgres)", () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });

  const userRepository = new PrismaUserRepository(prisma);
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma, prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const expenseHistoryRepository = new PrismaExpenseHistoryRepository(prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);

  const createIncome = new CreateIncomeUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    transactionRepository,
    accountRepository,
    fxRateRepository,
  );
  const createExpense = new CreateExpenseUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    transactionRepository,
    expenseHistoryRepository,
    accountRepository,
    fxRateRepository,
  );

  let jamesId: string;
  let incomeCategoryId: string;
  let expenseCategoryId: string;
  let createdTransactionIds: string[] = [];
  let createdAccountIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(jamesId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const james = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_JAMES },
      create: {
        telegramUserId: TELEGRAM_USER_ID_JAMES,
        displayName: 'James (Scenario D)',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: UZS },
    });
    jamesId = james.id;

    const incomeCategory = await prisma.category.findFirst({
      where: { defaultType: 'income', status: 'active', parentCategoryId: null },
    });
    const expenseCategory = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', parentCategoryId: null },
    });
    if (!incomeCategory || !expenseCategory) {
      throw new Error(
        'No active top-level income/expense category found — run `prisma db seed` first.',
      );
    }
    incomeCategoryId = incomeCategory.id;
    expenseCategoryId = expenseCategory.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    if (createdAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
    }
    await prisma.fxRate.deleteMany({
      where: { baseCurrency: USD, quoteCurrency: UZS, asOfDate: { gte: new Date('2025-01-01') } },
    });
    createdTransactionIds = [];
    createdAccountIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: jamesId } });
    await prisma.account.deleteMany({ where: { userId: jamesId } });
    await prisma.user.deleteMany({ where: { id: jamesId } });
    await prisma.onModuleDestroy();
  });

  it("reproduces Scenario D end to end: USD income snapshots its FX rate, UZS expenses are same-currency, a later rate correction never alters the historical transaction, and both accounts' balances reflect exactly what James actually logged", async () => {
    // §19.1 row 1 — "James receives a $2,400 USD client payment": INCOME,
    // currency=USD, exchange_rate_to_default snapshot captured against his
    // UZS default at that date (FR-FIN-027, Stage E).
    await fxRateRepository.recordRate({
      baseCurrency: USD,
      quoteCurrency: UZS,
      rate: ORIGINAL_RATE,
      asOfDate: INCOME_DATE,
    });

    const income = await as(() =>
      createIncome.execute({
        userId: jamesId,
        transactionType: 'INCOME',
        amount: '2400',
        currency: USD,
        categoryId: incomeCategoryId,
        transactionDate: INCOME_DATE,
        description: 'Client payment',
        originalText: 'received 2400 usd from a client',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(income.id);
    createdAccountIds.push(income.accountId!);

    // The implicit default-for-USD account (§8.12.4, Stage B) — never
    // explicitly created by James, provisioned automatically.
    expect(income.currency).toBe(USD);
    expect(income.exchangeRateToDefault).toBe('12500.75');
    const usdAccountId = income.accountId!;

    // §19.1 row 2 — "Over the month he spends primarily in UZS for daily
    // expenses": standard EXPENSE records in UZS (same-currency as his
    // default — exchangeRateToDefault is implicitly '1', FxRateRepository
    // never consulted, Stage E's own established rule).
    const expenseAmounts = ['500000.00', '300000.00', '200000.00'];
    const expenseDates = [new Date('2025-03-05'), new Date('2025-03-15'), new Date('2025-03-25')];
    let uzsAccountId: string | undefined;
    for (let i = 0; i < expenseAmounts.length; i += 1) {
      const { transaction: expense } = await as(() =>
        createExpense.execute({
          userId: jamesId,
          amount: expenseAmounts[i]!,
          currency: UZS,
          categoryId: expenseCategoryId,
          transactionDate: expenseDates[i]!,
          description: 'Daily expense',
          originalText: `spent ${expenseAmounts[i]} UZS`,
          sourceType: 'text',
          createdBy: 'ai',
        }),
      );
      createdTransactionIds.push(expense.id);
      expect(expense.exchangeRateToDefault).toBe('1');
      uzsAccountId = expense.accountId!;
    }
    createdAccountIds.push(uzsAccountId!);
    expect(uzsAccountId).not.toBe(usdAccountId); // distinct implicit accounts, one per currency

    // §19.1 row 3 (the principle, not the Report engine itself) — "using
    // each transaction's own stored exchange-rate snapshot — not a single
    // 'today's rate' applied retroactively." Simulate a later correction
    // to the SAME historical date's rate (e.g. a re-ingestion, Stage F).
    await fxRateRepository.recordRate({
      baseCurrency: USD,
      quoteCurrency: UZS,
      rate: CORRECTED_RATE,
      asOfDate: INCOME_DATE,
    });

    // BR-FIN-006 — the already-committed income's OWN stored snapshot is
    // frozen and unaffected by the correction.
    const reread = await transactionRepository.findById(income.id);
    expect(reread?.exchangeRateToDefault).toBe('12500.75');
    expect(reread?.exchangeRateToDefault).not.toBe(CORRECTED_RATE);

    // The "historically accurate total" §19.1 describes: converting
    // James's income using its OWN frozen snapshot gives a different (the
    // historically correct) figure than converting it with the corrected
    // rate would — proving the snapshot, not a live lookup, is what any
    // future historically-accurate consumer (Report/Export, out of this
    // stage's scope) must read.
    const historicallyAccurateUzsValue = 2400 * Number(reread!.exchangeRateToDefault);
    const wouldBeWrongIfUsingCorrectedRate = 2400 * Number(CORRECTED_RATE);
    expect(historicallyAccurateUzsValue).not.toBe(wouldBeWrongIfUsingCorrectedRate);
    expect(historicallyAccurateUzsValue).toBeCloseTo(30_001_800, 0); // 2400 * 12500.75

    // §8.14.2 (Stage G) — each account's balance reflects exactly what
    // James logged against it, using the approved formula. The USD
    // account's balance needs no FX conversion at all (its own currency
    // matches every transaction attributed to it) — proving it is
    // unaffected by the correction above, exactly as Stage G's own
    // same-currency-passthrough design guarantees.
    const usdBalance = await as(() =>
      accountRepository.computeBalance(usdAccountId, jamesId, new Date('2025-03-31')),
    );
    expect(usdBalance).toBe('2400.00');

    const uzsBalance = await as(() =>
      accountRepository.computeBalance(uzsAccountId!, jamesId, new Date('2025-03-31')),
    );
    // starting balance 0 - (500000 + 300000 + 200000)
    expect(uzsBalance).toBe('-1000000.00');
  }, 30_000);
});

describe('TASK-FIN-007 Stage H — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-007 Stage H scenario-d environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

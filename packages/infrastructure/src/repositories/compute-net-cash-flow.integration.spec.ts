import { CashFlowUnavailableError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { computeNetCashFlow } from './compute-net-cash-flow';
import { PrismaAccountRepository } from './prisma-account.repository';
import { PrismaFxRateRepository } from './prisma-fx-rate.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-008 (В§8.14.3) вЂ” real-Postgres proof for `computeNetCashFlow`,
 * the ONE shared implementation of `net_cash_flow(period)`. Tested
 * directly (no consuming repository/hook exists yet вЂ” Chapter 15's own
 * future consumption is out of this task's scope), the same convention
 * `compute-net-worth.integration.spec.ts` establishes for the sibling
 * new-in-this-task formula.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_001_040n;
const TELEGRAM_USER_ID_B = 900_000_001_041n;
const DEFAULT_CURRENCY = 'UZS';
const OTHER_CURRENCY = 'USD';
const SECOND_OTHER_CURRENCY = 'RUB';
// 2025-04 — a past, distinct-from-every-other-suite's-own fixture window.
const FX_DATE = new Date('2025-04-10');
const PERIOD_START = new Date('2025-04-01');
const PERIOD_END = new Date('2025-04-30');

describe('computeNetCashFlow вЂ” TASK-FIN-008 (В§8.14.3, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const accountRepository = new PrismaAccountRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);

  let userAId: string;
  let userBId: string;
  let categoryId: string;
  let transferCategoryId: string;
  let accountId: string;
  let secondAccountId: string;
  let createdTransactionIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: {
        telegramUserId: TELEGRAM_USER_ID_A,
        displayName: 'Net Cash Flow Test A',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userAId = userA.id;
    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: {
        telegramUserId: TELEGRAM_USER_ID_B,
        displayName: 'Net Cash Flow Test B',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userBId = userB.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', parentCategoryId: null },
    });
    if (!category) {
      throw new Error('No active top-level expense category found вЂ” run `prisma db seed` first.');
    }
    categoryId = category.id;

    const transferCategory = await prisma.category.findFirst({ where: { code: 'TRANSFER' } });
    if (!transferCategory) {
      throw new Error('No seeded TRANSFER category found вЂ” run `prisma db seed` first.');
    }
    transferCategoryId = transferCategory.id;

    const account = await as(userAId, () =>
      accountRepository.create({
        userId: userAId,
        name: 'Cash Flow Test Account',
        accountType: 'other',
        currency: DEFAULT_CURRENCY,
        startingBalance: '0.00',
        isDefault: false,
      }),
    );
    accountId = account.id;
    const secondAccount = await as(userAId, () =>
      accountRepository.create({
        userId: userAId,
        name: 'Cash Flow Test Account 2',
        accountType: 'other',
        currency: DEFAULT_CURRENCY,
        startingBalance: '0.00',
        isDefault: false,
      }),
    );
    secondAccountId = secondAccount.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: OTHER_CURRENCY,
        quoteCurrency: DEFAULT_CURRENCY,
        asOfDate: { gte: new Date('2025-04-01') },
      },
    });
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: SECOND_OTHER_CURRENCY,
        quoteCurrency: DEFAULT_CURRENCY,
        asOfDate: { gte: new Date('2025-04-01') },
      },
    });
    createdTransactionIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeTransaction(
    userId: string,
    type: 'EXPENSE' | 'INCOME' | 'SALARY' | 'REFUND',
    amount: string,
    currency: string,
    transactionDate: Date,
  ) {
    const transaction = await as(userId, () =>
      transactionRepository.create({
        userId,
        transactionType: type,
        accountId,
        amount,
        currency,
        categoryId,
        transactionDate,
        description: type,
        originalText: `${type} ${amount} ${currency}`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  it('A вЂ” reproduces В§8.14.3вЂ™s own formula: ОЈ(INCOME+SALARY+REFUND) в€’ ОЈ(EXPENSE) within the period', async () => {
    await makeTransaction(
      userAId,
      'INCOME',
      '1000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-05'),
    );
    await makeTransaction(
      userAId,
      'EXPENSE',
      '300000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-10'),
    );

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('700000.00');
  });

  it('B вЂ” SALARY and REFUND both count as income-like, alongside INCOME', async () => {
    await makeTransaction(
      userAId,
      'SALARY',
      '5000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-01'),
    );
    await makeTransaction(userAId, 'REFUND', '50000.00', DEFAULT_CURRENCY, new Date('2025-04-02'));
    await makeTransaction(
      userAId,
      'EXPENSE',
      '1000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-03'),
    );

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('4050000.00');
  });

  it('C вЂ” a TRANSFER never affects net_cash_flow (BR-FIN-001, the same principle already established for budget/expense totals)', async () => {
    await makeTransaction(
      userAId,
      'INCOME',
      '1000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-05'),
    );
    const transferTxn = await as(userAId, () =>
      transactionRepository.create({
        userId: userAId,
        transactionType: 'TRANSFER',
        sourceAccountId: accountId,
        destinationAccountId: secondAccountId,
        amount: '400000.00',
        currency: DEFAULT_CURRENCY,
        categoryId: transferCategoryId,
        transactionDate: new Date('2025-04-06'),
        description: 'transfer',
        originalText: 'transfer 400000 UZS',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transferTxn.id);

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('1000000.00'); // unaffected by the transfer
  });

  it('D вЂ” respects the period boundary: a transaction dated outside [periodStart, periodEnd] is excluded', async () => {
    await makeTransaction(
      userAId,
      'INCOME',
      '1000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-05-01'),
    ); // after periodEnd

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('0.00');
  });

  it('E вЂ” converts a cross-currency transaction via a live fx_rates lookup (BR-FIN-006)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '12500.00',
      asOfDate: FX_DATE,
    });
    await makeTransaction(userAId, 'INCOME', '100.00', OTHER_CURRENCY, new Date('2025-04-10')); // 100 * 12500 = 1,250,000

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('1250000.00');
  });

  it('F вЂ” throws CashFlowUnavailableError when no exchange rate exists at all for a cross-currency transaction (FR-FIN-043)', async () => {
    await makeTransaction(userAId, 'INCOME', '100.00', OTHER_CURRENCY, new Date('2025-04-10')); // no fx_rates row

    await expect(
      computeNetCashFlow(prisma, {
        userId: userAId,
        defaultCurrency: DEFAULT_CURRENCY,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toThrow(CashFlowUnavailableError);
  });

  it('G вЂ” a soft-deleted transaction is excluded', async () => {
    const txn = await makeTransaction(
      userAId,
      'INCOME',
      '1000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-05'),
    );
    await prisma.transaction.update({ where: { id: txn.id }, data: { deletedAt: new Date() } });

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('0.00');
  });

  it('H вЂ” scoped to the exact user: another userвЂ™s transactions never leak in', async () => {
    await makeTransaction(
      userAId,
      'INCOME',
      '1000000.00',
      DEFAULT_CURRENCY,
      new Date('2025-04-05'),
    );

    const netCashFlowForB = await computeNetCashFlow(prisma, {
      userId: userBId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlowForB).toBe('0.00');
  });

  it('I вЂ” TASK-FIN-008 (precision-bug fix): raw income 1.004 minus raw expense 0.996 rounds ONCE, at the end, to 0.01 вЂ” never round(1.004)-round(0.996)=0.00', async () => {
    // Two DIFFERENT cross-currency legs (fx_rates has one rate per
    // (base,quote,date) triple, so two independent raw sub-cent residues
    // require two different base currencies) chosen so each side's own
    // raw SQL SUM lands exactly on the values from the approved
    // counter-example: 1.00 USD * 1.00400000 = 1.004; 1.00 RUB * 0.99600000
    // (RUB->UZS) = 0.996.
    await fxRateRepository.recordRate({
      baseCurrency: OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '1.00400000',
      asOfDate: FX_DATE,
    });
    await fxRateRepository.recordRate({
      baseCurrency: SECOND_OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '0.99600000',
      asOfDate: FX_DATE,
    });
    await makeTransaction(userAId, 'INCOME', '1.00', OTHER_CURRENCY, new Date('2025-04-10'));
    const expenseTxn = await as(userAId, () =>
      transactionRepository.create({
        userId: userAId,
        transactionType: 'EXPENSE',
        accountId,
        amount: '1.00',
        currency: SECOND_OTHER_CURRENCY,
        categoryId,
        transactionDate: new Date('2025-04-10'),
        description: 'EXPENSE',
        originalText: 'EXPENSE 1.00 RUB',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(expenseTxn.id);

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('0.01');
  });

  it('J вЂ” a single cross-currency transaction with a genuinely fractional (non-round-number) rate rounds correctly', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '0.12345678',
      asOfDate: FX_DATE,
    });
    await makeTransaction(userAId, 'INCOME', '10.00', OTHER_CURRENCY, new Date('2025-04-10'));
    // raw = 10.00 * 0.12345678 = 1.2345678000 -> HALF-UP to 2dp = 1.23
    // (3rd decimal is 4, rounds down).

    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userAId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(netCashFlow).toBe('1.23');
  });

  it('K вЂ” an empty period (zero transactions at all) returns "0.00", never a throw or null', async () => {
    const netCashFlow = await computeNetCashFlow(prisma, {
      userId: userBId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: new Date('2025-04-15'),
      periodEnd: new Date('2025-04-20'),
    });
    expect(netCashFlow).toBe('0.00');
  });
});

describe('computeNetCashFlow вЂ” environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-008 net-cash-flow environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

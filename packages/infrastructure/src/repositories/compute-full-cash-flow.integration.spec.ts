import { FullCashFlowUnavailableError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { computeFullCashFlow } from './compute-full-cash-flow';
import { PrismaAccountRepository } from './prisma-account.repository';
import { PrismaDebtRepository } from './prisma-debt.repository';
import { PrismaFxRateRepository } from './prisma-fx-rate.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-008 (§8.14.3's second formula) — real-Postgres proof for
 * `computeFullCashFlow`, the ONE shared implementation of
 * `full_cash_flow(period)`. Tested directly, the same convention every
 * sibling formula in this task establishes.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID = 900_000_001_050n;
const DEFAULT_CURRENCY = 'UZS';
const USD = 'USD';
const RUB = 'RUB';
// 2025-06 — a past, distinct-from-every-other-suite's-own fixture window.
const FX_DATE = new Date('2025-06-10');
const PERIOD_START = new Date('2025-06-01');
const PERIOD_END = new Date('2025-06-30');

describe('computeFullCashFlow — TASK-FIN-008 (§8.14.3, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const accountRepository = new PrismaAccountRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);
  const debtRepository = new PrismaDebtRepository(prisma, prisma);

  let userId: string;
  let categoryId: string;
  let transferCategoryId: string;
  let uzsAccountId: string;
  let uzsAccountId2: string;
  let usdAccountId: string;
  let rubAccountId: string;
  let createdTransactionIds: string[] = [];
  let createdDebtIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const user = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Full Cash Flow Test',
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

    const transferCategory = await prisma.category.findFirst({ where: { code: 'TRANSFER' } });
    if (!transferCategory) {
      throw new Error('No seeded TRANSFER category found — run `prisma db seed` first.');
    }
    transferCategoryId = transferCategory.id;

    const uzsAccount = await as(() =>
      accountRepository.create({
        userId,
        name: 'Full Cash Flow UZS',
        accountType: 'other',
        currency: DEFAULT_CURRENCY,
        startingBalance: '0.00',
        isDefault: false,
      }),
    );
    uzsAccountId = uzsAccount.id;

    const uzsAccount2 = await as(() =>
      accountRepository.create({
        userId,
        name: 'Full Cash Flow UZS 2',
        accountType: 'other',
        currency: DEFAULT_CURRENCY,
        startingBalance: '0.00',
        isDefault: false,
      }),
    );
    uzsAccountId2 = uzsAccount2.id;

    const usdAccount = await as(() =>
      accountRepository.create({
        userId,
        name: 'Full Cash Flow USD',
        accountType: 'other',
        currency: USD,
        startingBalance: '0.00',
        isDefault: false,
      }),
    );
    usdAccountId = usdAccount.id;

    const rubAccount = await as(() =>
      accountRepository.create({
        userId,
        name: 'Full Cash Flow RUB',
        accountType: 'other',
        currency: RUB,
        startingBalance: '0.00',
        isDefault: false,
      }),
    );
    rubAccountId = rubAccount.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    if (createdDebtIds.length > 0) {
      await prisma.debtRepayment.deleteMany({ where: { debtId: { in: createdDebtIds } } });
      await prisma.debt.deleteMany({ where: { id: { in: createdDebtIds } } });
    }
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: { in: [USD, RUB] },
        quoteCurrency: DEFAULT_CURRENCY,
        asOfDate: { gte: new Date('2025-06-01') },
      },
    });
    createdTransactionIds = [];
    createdDebtIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function makeTransaction(
    type: 'EXPENSE' | 'INCOME',
    amount: string,
    currency: string,
    transactionDate: Date,
  ) {
    const transaction = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: type,
        accountId: uzsAccountId,
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

  async function makeTransfer(
    sourceAccountId: string,
    destinationAccountId: string,
    amount: string,
    currency: string,
    destinationAmount: string | undefined,
    transactionDate: Date,
  ) {
    const transaction = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'TRANSFER',
        sourceAccountId,
        destinationAccountId,
        amount,
        currency,
        destinationAmount,
        categoryId: transferCategoryId,
        transactionDate,
        description: 'transfer',
        originalText: `transfer ${amount} ${currency}`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  async function makeDebt(
    direction: 'given' | 'received',
    amount: string,
    transactionDate: Date,
    currency: string = DEFAULT_CURRENCY,
  ) {
    const debt = await as(() =>
      debtRepository.create({
        userId,
        direction,
        counterpartyName: 'Test Counterparty',
        counterpartyRefId: null,
        originalAmount: amount,
        currency,
        transactionDate,
        dueDate: null,
        notes: null,
        originalText: `${direction} ${amount} ${currency}`,
      }),
    );
    createdDebtIds.push(debt.id);
    return debt;
  }

  async function makeRepayment(debtId: string, amount: string, repaymentDate: Date) {
    const result = await as(() =>
      debtRepository.logRepayment({
        debtId,
        amount,
        currency: DEFAULT_CURRENCY,
        repaymentDate,
        originalText: `repayment ${amount} UZS`,
      }),
    );
    if (!result) {
      throw new Error('logRepayment unexpectedly returned null in test setup.');
    }
    return result;
  }

  it('A — normal case: net_cash_flow base + debt given/received + repayments both directions + a same-currency transfer (which contributes exactly 0)', async () => {
    await makeTransaction('INCOME', '1000000.00', DEFAULT_CURRENCY, new Date('2025-06-05'));
    await makeTransaction('EXPENSE', '300000.00', DEFAULT_CURRENCY, new Date('2025-06-06'));
    const given = await makeDebt('given', '100000.00', new Date('2025-06-07'));
    const received = await makeDebt('received', '250000.00', new Date('2025-06-08'));
    await makeRepayment(given.id, '40000.00', new Date('2025-06-09')); // DEBT_REPAYMENT_RECEIVED: +40,000
    await makeRepayment(received.id, '60000.00', new Date('2025-06-10')); // DEBT_REPAYMENT_MADE: -60,000
    await makeTransfer(
      uzsAccountId,
      uzsAccountId2,
      '75000.00',
      DEFAULT_CURRENCY,
      undefined,
      new Date('2025-06-11'),
    );
    // Same-currency transfer between two of the user's own UZS accounts —
    // contributes exactly 0 (proven in isolation by test B), included here
    // to prove it does NOT skew the total once debt terms are also present.

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    // net_cash_flow = 1,000,000 - 300,000 = 700,000
    // debt term = -100,000 (given) + 250,000 (received) + 40,000 (repayment received) - 60,000 (repayment made) = 130,000
    // transfer term (0.00 same-currency) = 0
    // total = 700,000 + 130,000 = 830,000
    expect(fullCashFlow).toBe('830000.00');
  });

  it('B — a same-currency transfer alone contributes exactly 0.00 (internal moves are cash-flow-neutral)', async () => {
    await makeTransfer(
      uzsAccountId,
      uzsAccountId2,
      '75000.00',
      DEFAULT_CURRENCY,
      undefined,
      new Date('2025-06-05'),
    );

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(fullCashFlow).toBe('0.00');
  });

  it('C — a cross-currency transfer contributes the derived nonzero FX-differential amount', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: USD,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '12000.00',
      asOfDate: FX_DATE,
    });
    await fxRateRepository.recordRate({
      baseCurrency: RUB,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '130.00',
      asOfDate: FX_DATE,
    });
    await makeTransfer(usdAccountId, rubAccountId, '10.00', USD, '900.00', new Date('2025-06-10'));
    // source leg: -(10.00 * 12000.00) = -120,000
    // destination leg: +(900.00 * 130.00) = +117,000
    // contribution: -3,000

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(fullCashFlow).toBe('-3000.00');
  });

  it('D — a debt given (I lent money) alone contributes its negative amount', async () => {
    await makeDebt('given', '500000.00', new Date('2025-06-05'));

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(fullCashFlow).toBe('-500000.00');
  });

  it('E — a debt received (I borrowed money) alone contributes its positive amount', async () => {
    await makeDebt('received', '500000.00', new Date('2025-06-05'));

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(fullCashFlow).toBe('500000.00');
  });

  it('F — a repayment on a debt I GAVE (money coming back, DEBT_REPAYMENT_RECEIVED) contributes positively', async () => {
    const given = await makeDebt('given', '500000.00', new Date('2025-06-01'));
    await makeRepayment(given.id, '150000.00', new Date('2025-06-15'));

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    // debt given (-500,000) + repayment received (+150,000) = -350,000
    expect(fullCashFlow).toBe('-350000.00');
  });

  it('G — a repayment on a debt I RECEIVED (money paid out, DEBT_REPAYMENT_MADE) contributes negatively', async () => {
    const received = await makeDebt('received', '500000.00', new Date('2025-06-01'));
    await makeRepayment(received.id, '150000.00', new Date('2025-06-15'));

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    // debt received (+500,000) + repayment made (-150,000) = 350,000
    expect(fullCashFlow).toBe('350000.00');
  });

  it('H — respects the period boundary: a debt dated outside the period is excluded', async () => {
    await makeDebt('given', '500000.00', new Date('2025-07-01')); // after periodEnd

    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(fullCashFlow).toBe('0.00');
  });

  it('I — throws FullCashFlowUnavailableError when no exchange rate exists for a cross-currency debt (FR-FIN-043)', async () => {
    await makeDebt('given', '100.00', new Date('2025-06-05'), USD);
    // no fx_rates row recorded for USD -> UZS in this suite's own window

    await expect(
      computeFullCashFlow(prisma, {
        userId,
        defaultCurrency: DEFAULT_CURRENCY,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toThrow(FullCashFlowUnavailableError);
  });

  it('J — throws FullCashFlowUnavailableError when no exchange rate exists for a cross-currency transfer leg (FR-FIN-043)', async () => {
    await makeTransfer(usdAccountId, rubAccountId, '10.00', USD, '900.00', new Date('2025-06-10'));
    // no fx_rates rows recorded for USD -> UZS or RUB -> UZS in this suite's own window

    await expect(
      computeFullCashFlow(prisma, {
        userId,
        defaultCurrency: DEFAULT_CURRENCY,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toThrow(FullCashFlowUnavailableError);
  });

  it('K — an empty period (zero activity at all) returns "0.00", never a throw or null', async () => {
    const fullCashFlow = await computeFullCashFlow(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      periodStart: new Date('2025-06-15'),
      periodEnd: new Date('2025-06-20'),
    });
    expect(fullCashFlow).toBe('0.00');
  });
});

describe('computeFullCashFlow — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-008 full-cash-flow environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

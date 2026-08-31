import { NetWorthUnavailableError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { computeNetWorth } from './compute-net-worth';
import { PrismaAccountRepository } from './prisma-account.repository';
import { PrismaFxRateRepository } from './prisma-fx-rate.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-008 (§8.14.2) — real-Postgres proof for `computeNetWorth`, the
 * ONE shared implementation of `net_worth(user, as_of_date)`. No
 * repository/use-case wraps this yet (Chapter 9/15's own future
 * consumption is out of this task's scope, per §8.14.1's own "this chapter
 * never performs trend analysis... only the underlying arithmetic"
 * boundary) — tested directly here, the same way `computeBudgetUsedAmount`/
 * `computeSavingsGoalProgress` were tested directly before their own
 * consuming hooks existed.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID = 900_000_001_030n;
const DEFAULT_CURRENCY = 'UZS';
const OTHER_CURRENCY = 'USD';
const SECOND_OTHER_CURRENCY = 'RUB';
// 2025-03 — a past, distinct-from-every-other-suite's-own fixture window.
const FX_DATE = new Date('2025-03-10');
const AS_OF_DATE = new Date('2025-03-20');

describe('computeNetWorth — TASK-FIN-008 (§8.14.2, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const accountRepository = new PrismaAccountRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  let userId: string;
  let categoryId: string;
  let createdAccountIds: string[] = [];
  let createdTransactionIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const user = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: { telegramUserId: TELEGRAM_USER_ID, displayName: 'Net Worth Test', timezone: 'UTC' },
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
    if (createdAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
    }
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: OTHER_CURRENCY,
        quoteCurrency: DEFAULT_CURRENCY,
        asOfDate: { gte: new Date('2025-03-01') },
      },
    });
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: SECOND_OTHER_CURRENCY,
        quoteCurrency: DEFAULT_CURRENCY,
        asOfDate: { gte: new Date('2025-03-01') },
      },
    });
    createdAccountIds = [];
    createdTransactionIds = [];
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function makeAccount(currency: string, startingBalance: string) {
    const account = await as(() =>
      accountRepository.create({
        userId,
        name: 'Net Worth Test Account',
        accountType: 'other',
        currency,
        startingBalance,
        isDefault: false,
      }),
    );
    createdAccountIds.push(account.id);
    return account;
  }

  it('A — a single same-currency account: net worth equals its starting balance', async () => {
    await makeAccount(DEFAULT_CURRENCY, '500000.00');

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('500000.00');
  });

  it('B — multiple same-currency accounts sum correctly', async () => {
    await makeAccount(DEFAULT_CURRENCY, '500000.00');
    await makeAccount(DEFAULT_CURRENCY, '250000.50');

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('750000.50');
  });

  it('C — a cross-currency account is converted to defaultCurrency via fx_rates (BR-FIN-006)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '12500.00',
      asOfDate: FX_DATE,
    });
    await makeAccount(DEFAULT_CURRENCY, '100000.00');
    await makeAccount(OTHER_CURRENCY, '100.00'); // 100 USD * 12500 = 1,250,000 UZS

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('1350000.00'); // 100,000 + 1,250,000
  });

  it('D — an archived (not soft-deleted) account is included, matching account_balance’s own "archived remains computable" stance', async () => {
    const account = await makeAccount(DEFAULT_CURRENCY, '300000.00');
    await prisma.account.update({ where: { id: account.id }, data: { status: 'archived' } });

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('300000.00');
  });

  it('E — a soft-deleted account is excluded', async () => {
    const account = await makeAccount(DEFAULT_CURRENCY, '400000.00');
    await prisma.account.update({ where: { id: account.id }, data: { deletedAt: new Date() } });

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('0.00');
  });

  it('F — throws NetWorthUnavailableError when no exchange rate exists at all for a cross-currency account (FR-FIN-043), never a silently incomplete figure', async () => {
    await makeAccount(OTHER_CURRENCY, '100.00'); // no fx_rates row recorded for USD -> UZS

    await expect(
      computeNetWorth(prisma, { userId, defaultCurrency: DEFAULT_CURRENCY, asOfDate: AS_OF_DATE }),
    ).rejects.toThrow(NetWorthUnavailableError);
  });

  it('G — a user with zero accounts has a net worth of "0.00"', async () => {
    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('0.00');
  });

  it('H — TASK-FIN-008 (precision-bug fix): a genuinely fractional (non-round-number) FX rate rounds correctly on the final total, not per-account', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '0.12345678',
      asOfDate: FX_DATE,
    });
    await makeAccount(OTHER_CURRENCY, '10.00');
    // raw = 10.00 * 0.12345678 = 1.2345678 -> HALF-UP to 2dp = 1.23
    // (3rd decimal is 4, rounds down).

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('1.23');
  });

  it('I — TASK-FIN-008 (precision-bug fix): cumulative cross-account rounding is applied ONCE, on the final total — never round(a)+round(b)', async () => {
    // Two DIFFERENT currencies (fx_rates has one rate per (base,quote,date)
    // triple, so two independently-controllable raw sub-cent residues
    // require two different base currencies) chosen so each account's own
    // raw converted balance lands exactly on the approved counter-example:
    // 1.00 USD * 1.00400000 = 1.004; 1.00 RUB * 0.99400000 = 0.994.
    // Old (per-account-rounded) behavior: round(1.004) + round(0.994) =
    // 1.00 + 0.99 = 1.99. Correct: round(1.004 + 0.994) = round(1.998) =
    // 2.00.
    await fxRateRepository.recordRate({
      baseCurrency: OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '1.00400000',
      asOfDate: FX_DATE,
    });
    await fxRateRepository.recordRate({
      baseCurrency: SECOND_OTHER_CURRENCY,
      quoteCurrency: DEFAULT_CURRENCY,
      rate: '0.99400000',
      asOfDate: FX_DATE,
    });
    await makeAccount(OTHER_CURRENCY, '1.00');
    await makeAccount(SECOND_OTHER_CURRENCY, '1.00');

    const netWorth = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: AS_OF_DATE,
    });
    expect(netWorth).toBe('2.00');
  });

  it('J — asOfDate genuinely filters real transactions, not just the fixed starting_balance', async () => {
    const account = await makeAccount(DEFAULT_CURRENCY, '1000000.00');
    const transaction = await as(() =>
      transactionRepository.create({
        userId,
        transactionType: 'EXPENSE',
        accountId: account.id,
        amount: '100000.00',
        currency: DEFAULT_CURRENCY,
        categoryId,
        transactionDate: new Date('2025-03-15'),
        description: 'EXPENSE',
        originalText: 'EXPENSE 100000.00 UZS',
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);

    const netWorthBefore = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: new Date('2025-03-10'), // before the transaction
    });
    expect(netWorthBefore).toBe('1000000.00');

    const netWorthAfter = await computeNetWorth(prisma, {
      userId,
      defaultCurrency: DEFAULT_CURRENCY,
      asOfDate: new Date('2025-03-20'), // after the transaction
    });
    expect(netWorthAfter).toBe('900000.00');
  });
});

describe('computeNetWorth — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-008 net-worth environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

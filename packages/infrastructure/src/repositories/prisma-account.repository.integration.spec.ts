import { AccountBalanceUnavailableError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from './prisma-account.repository';
import { PrismaFxRateRepository } from './prisma-fx-rate.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-007 (Stage B) — real-Postgres proof for `PrismaAccountRepository`.
 * Owner-role connection, matching every real-Postgres suite in this package
 * (`prisma-debt.repository.integration.spec.ts`'s own established
 * convention). `Account` is RLS-protected; every mutating call runs inside
 * `runWithUserContext`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID_A = 900_000_000_974n;
const TELEGRAM_USER_ID_B = 900_000_000_975n;
const CURRENCY_CODE = 'UZS';

describe('PrismaAccountRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const accountRepository = new PrismaAccountRepository(prisma);
  let userAId: string;
  let userBId: string;
  let createdAccountIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: {
        telegramUserId: TELEGRAM_USER_ID_A,
        displayName: 'Account Test A',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userAId = userA.id;
    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: {
        telegramUserId: TELEGRAM_USER_ID_B,
        displayName: 'Account Test B',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userBId = userB.id;
  });

  afterEach(async () => {
    if (createdAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
    }
    createdAccountIds = [];
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeAccount(
    userId: string,
    overrides: Partial<Parameters<typeof accountRepository.create>[0]> = {},
  ) {
    const account = await as(userId, () =>
      accountRepository.create({
        userId,
        name: 'Cash wallet',
        accountType: 'cash',
        currency: CURRENCY_CODE,
        startingBalance: '500000.00',
        isDefault: false,
        ...overrides,
      }),
    );
    createdAccountIds.push(account.id);
    return account;
  }

  it('A — create() persists a valid account', async () => {
    const account = await makeAccount(userAId);
    expect(account.name).toBe('Cash wallet');
    expect(account.accountType).toBe('cash');
    expect(account.startingBalance).toBe('500000.00');
    expect(account.status).toBe('active');
  });

  it('B — create() persists a negative startingBalance (§8.12.3)', async () => {
    const account = await makeAccount(userAId, {
      name: 'Credit card',
      accountType: 'bank_card',
      startingBalance: '-150000.00',
    });
    expect(account.startingBalance).toBe('-150000.00');
  });

  it('C — findActiveByUserId excludes archived accounts', async () => {
    const account = await makeAccount(userAId);
    await as(userAId, () => accountRepository.archive(account.id, userAId));

    const active = await as(userAId, () => accountRepository.findActiveByUserId(userAId));
    expect(active.map((a) => a.id)).not.toContain(account.id);

    // An archived account remains individually findable (FR-FIN-025 — "an
    // archived account's historical transactions remain queryable").
    const found = await as(userAId, () => accountRepository.findById(account.id));
    expect(found?.status).toBe('archived');
  });

  it('D — findActiveByUserId excludes a soft-deleted account (defense-in-depth; no current use case sets deletedAt)', async () => {
    const account = await makeAccount(userAId);
    await prisma.account.update({ where: { id: account.id }, data: { deletedAt: new Date() } });

    const active = await as(userAId, () => accountRepository.findActiveByUserId(userAId));
    expect(active.map((a) => a.id)).not.toContain(account.id);
  });

  it('E — update() edits name/accountType, scoped to the owning user; a different user cannot edit it', async () => {
    const account = await makeAccount(userAId);

    const updated = await as(userAId, () =>
      accountRepository.update(account.id, userAId, {
        name: 'Renamed wallet',
        accountType: 'other',
      }),
    );
    expect(updated?.name).toBe('Renamed wallet');
    expect(updated?.accountType).toBe('other');

    const deniedForOtherUser = await as(userBId, () =>
      accountRepository.update(account.id, userBId, { name: 'Hijacked' }),
    );
    expect(deniedForOtherUser).toBeNull();
  });

  it('F — archive() is idempotent-safe: a second archive attempt returns null, never a second write', async () => {
    const account = await makeAccount(userAId);

    const first = await as(userAId, () => accountRepository.archive(account.id, userAId));
    expect(first?.status).toBe('archived');

    const second = await as(userAId, () => accountRepository.archive(account.id, userAId));
    expect(second).toBeNull();
  });

  it("G — cross-user isolation: user B's findActiveByUserId never returns user A's accounts, and cannot archive them", async () => {
    const account = await makeAccount(userAId);

    const activeForB = await as(userBId, () => accountRepository.findActiveByUserId(userBId));
    expect(activeForB.map((a) => a.userId)).not.toContain(userAId);

    const deniedArchive = await as(userBId, () => accountRepository.archive(account.id, userBId));
    expect(deniedArchive).toBeNull();
  });

  it('H — findOrCreateDefaultForCurrency creates exactly one implicit account per (user, currency), returning the same one on repeated calls (§8.12.4)', async () => {
    const first = await as(userAId, () =>
      accountRepository.findOrCreateDefaultForCurrency(userAId, 'RUB'),
    );
    createdAccountIds.push(first.id);
    expect(first.isDefault).toBe(true);
    expect(first.currency).toBe('RUB');

    const second = await as(userAId, () =>
      accountRepository.findOrCreateDefaultForCurrency(userAId, 'RUB'),
    );
    expect(second.id).toBe(first.id);

    const activeForA = await as(userAId, () => accountRepository.findActiveByUserId(userAId));
    expect(activeForA.filter((a) => a.currency === 'RUB' && a.isDefault)).toHaveLength(1);
  });

  it('I — findOrCreateDefaultForCurrency is scoped per currency — two different currencies get two different implicit accounts', async () => {
    const usd = await as(userAId, () =>
      accountRepository.findOrCreateDefaultForCurrency(userAId, 'USD'),
    );
    createdAccountIds.push(usd.id);
    const eur = await as(userAId, () =>
      accountRepository.findOrCreateDefaultForCurrency(userAId, 'EUR'),
    );
    createdAccountIds.push(eur.id);

    expect(usd.id).not.toBe(eur.id);
    expect(usd.currency).toBe('USD');
    expect(eur.currency).toBe('EUR');
  });
});

describe('PrismaAccountRepository.computeBalance() — §8.14.2 (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const accountRepository = new PrismaAccountRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);

  const TELEGRAM_USER_ID_C = 900_000_000_976n;
  const TELEGRAM_USER_ID_D = 900_000_000_977n;
  const BASE = 'USD';
  const QUOTE = 'UZS';
  // 2024 — distinct from every other suite's own out-of-band fixture years
  // (Stage C 2020, Stage E 2022, Stage F 2023).
  const FX_TEST_DATE = new Date('2024-05-10');

  let userCId: string;
  let userDId: string;
  let categoryId: string;
  let transferCategoryId: string;
  let createdAccountIds: string[] = [];
  let createdTransactionIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userC = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_C },
      create: {
        telegramUserId: TELEGRAM_USER_ID_C,
        displayName: 'Balance Test C',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userCId = userC.id;
    const userD = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_D },
      create: {
        telegramUserId: TELEGRAM_USER_ID_D,
        displayName: 'Balance Test D',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userDId = userD.id;

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
        asOfDate: { gte: new Date('2024-01-01') },
      },
    });
    createdTransactionIds = [];
    createdAccountIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: { in: [userCId, userDId] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [userCId, userDId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userCId, userDId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeAccountFor(userId: string, currency: string, startingBalance: string) {
    const account = await as(userId, () =>
      accountRepository.create({
        userId,
        name: 'Balance Test Account',
        accountType: 'other',
        currency,
        startingBalance,
        isDefault: false,
      }),
    );
    createdAccountIds.push(account.id);
    return account;
  }

  async function spend(
    userId: string,
    accountId: string,
    currency: string,
    amount: string,
    transactionDate: Date,
    type: 'EXPENSE' | 'INCOME' = 'EXPENSE',
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
        description: type === 'EXPENSE' ? 'spend' : 'earn',
        originalText: `${type} ${amount} ${currency}`,
        sourceType: 'text',
        createdBy: 'ai',
      }),
    );
    createdTransactionIds.push(transaction.id);
    return transaction;
  }

  async function transfer(
    userId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    currency: string,
    amount: string,
    transactionDate: Date,
    destinationAmount?: string,
  ) {
    const transaction = await as(userId, () =>
      transactionRepository.create({
        userId,
        transactionType: 'TRANSFER',
        sourceAccountId,
        destinationAccountId,
        amount,
        destinationAmount,
        currency,
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

  it('A — starting balance only, no transactions', async () => {
    const account = await makeAccountFor(userCId, 'UZS', '100000.00');

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, new Date('2024-06-01')),
    );

    expect(balance).toBe('100000.00');
  });

  it('B — sums same-currency inflows and outflows correctly (EXPENSE decreases, INCOME/SALARY/REFUND-shaped INCOME increases)', async () => {
    const account = await makeAccountFor(userCId, 'UZS', '100000.00');
    await spend(userCId, account.id, 'UZS', '30000.00', new Date('2024-06-01'), 'EXPENSE');
    await spend(userCId, account.id, 'UZS', '50000.00', new Date('2024-06-02'), 'INCOME');

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, new Date('2024-06-30')),
    );

    // 100000 - 30000 + 50000 = 120000
    expect(balance).toBe('120000.00');
  });

  it('C — respects asOfDate: a transaction dated after asOfDate is excluded', async () => {
    const account = await makeAccountFor(userCId, 'UZS', '100000.00');
    await spend(userCId, account.id, 'UZS', '30000.00', new Date('2024-06-01'), 'EXPENSE');
    await spend(userCId, account.id, 'UZS', '999999.00', new Date('2024-07-15'), 'INCOME');

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, new Date('2024-06-30')),
    );

    expect(balance).toBe('70000.00'); // only the June EXPENSE counted
  });

  it('D — excludes a soft-deleted transaction (FR-FIN-002 — Committed-state only)', async () => {
    const account = await makeAccountFor(userCId, 'UZS', '100000.00');
    const transaction = await spend(userCId, account.id, 'UZS', '30000.00', new Date('2024-06-01'));
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { deletedAt: new Date() },
    });

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, new Date('2024-06-30')),
    );

    expect(balance).toBe('100000.00'); // the soft-deleted EXPENSE never counted
  });

  it('E — returns null for a non-existent account, and null when the account belongs to a different user (ownership enforced before computation)', async () => {
    const account = await makeAccountFor(userCId, 'UZS', '100000.00');

    await expect(
      as(userCId, () =>
        accountRepository.computeBalance(
          '00000000-0000-0000-0000-000000000000',
          userCId,
          new Date(),
        ),
      ),
    ).resolves.toBeNull();

    await expect(
      as(userDId, () => accountRepository.computeBalance(account.id, userDId, new Date())),
    ).resolves.toBeNull();
  });

  it('F — an archived (not soft-deleted) account remains computable (FR-FIN-025)', async () => {
    const account = await makeAccountFor(userCId, 'UZS', '100000.00');
    await spend(userCId, account.id, 'UZS', '20000.00', new Date('2024-06-01'));
    await as(userCId, () => accountRepository.archive(account.id, userCId));

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, new Date('2024-06-30')),
    );

    expect(balance).toBe('80000.00');
  });

  it('G — converts a cross-currency transaction via a live fx_rates lookup, never via Transaction.exchangeRateToDefault', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12500.00',
      asOfDate: FX_TEST_DATE,
    });
    // account.currency = UZS, but the transaction is logged in USD — an
    // explicit-accountId cross-currency attribution (Stage E allows this).
    const account = await makeAccountFor(userCId, QUOTE, '0.00');
    await spend(userCId, account.id, BASE, '10', FX_TEST_DATE, 'EXPENSE');

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, FX_TEST_DATE),
    );

    // 0 - (10 USD * 12500.00) = -125000.00 UZS
    expect(balance).toBe('-125000.00');
  });

  it('H — falls back to the most recent PRIOR fx_rates row when no exact-date rate exists (FR-FIN-029, same fallback FxRateRepository.findRate already implements)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12000.00',
      asOfDate: new Date('2024-05-01'),
    });
    const account = await makeAccountFor(userCId, QUOTE, '0.00');
    // No rate recorded for 2024-05-05 — must fall back to 2024-05-01's rate.
    await spend(userCId, account.id, BASE, '5', new Date('2024-05-05'), 'EXPENSE');

    const balance = await as(userCId, () =>
      accountRepository.computeBalance(account.id, userCId, new Date('2024-05-31')),
    );

    // 0 - (5 USD * 12000.00) = -60000.00 UZS
    expect(balance).toBe('-60000.00');
  });

  it('I — FR-FIN-043: throws rather than silently treating a missing exchange rate as zero, and never returns the incomplete partial sum', async () => {
    const account = await makeAccountFor(userCId, QUOTE, '500000.00');
    // EUR -> UZS has no seeded fx_rates row anywhere in this suite.
    await spend(userCId, account.id, 'EUR', '100', new Date('2024-05-20'), 'EXPENSE');

    await expect(
      as(userCId, () =>
        accountRepository.computeBalance(account.id, userCId, new Date('2024-05-31')),
      ),
    ).rejects.toThrow(AccountBalanceUnavailableError);
  });

  it('J — a mix of one resolvable and one unresolvable cross-currency transaction still throws (the resolvable one never masks the unresolvable one)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12500.00',
      asOfDate: FX_TEST_DATE,
    });
    const account = await makeAccountFor(userCId, QUOTE, '500000.00');
    await spend(userCId, account.id, BASE, '10', FX_TEST_DATE, 'EXPENSE'); // resolvable
    await spend(userCId, account.id, 'EUR', '20', FX_TEST_DATE, 'EXPENSE'); // unresolvable

    await expect(
      as(userCId, () => accountRepository.computeBalance(account.id, userCId, FX_TEST_DATE)),
    ).rejects.toThrow(AccountBalanceUnavailableError);
  });

  it('K — TASK-FIN-004 Stage G, AC-FIN-002: a same-currency TRANSFER decreases the source account and increases the destination account by exactly the transferred amount', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '500000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    await transfer(userCId, source.id, destination.id, 'UZS', '200000.00', new Date('2024-06-01'));

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('300000.00'); // 500000 - 200000
    expect(destinationBalance).toBe('200000.00'); // 0 + 200000
  });

  it('L — TASK-FIN-004 Stage G, FR-FIN-005: a cross-currency TRANSFER credits the destination with destinationAmount (never a live fx_rates conversion of amount)', async () => {
    const source = await makeAccountFor(userCId, BASE, '1000.00');
    const destination = await makeAccountFor(userCId, QUOTE, '0.00');
    // No fx_rates row seeded for BASE->QUOTE at this date — proves the
    // destination credit never goes through the fx LATERAL join at all.
    await transfer(
      userCId,
      source.id,
      destination.id,
      BASE,
      '100',
      new Date('2024-06-01'),
      '1250000.00',
    );

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('900.00'); // 1000 - 100 (source's own currency, no conversion)
    expect(destinationBalance).toBe('1250000.00'); // 0 + destinationAmount, as supplied
  });

  it('M — excludes a soft-deleted TRANSFER from both accounts (FR-FIN-002 — Committed-state only)', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '500000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    const transaction = await transfer(
      userCId,
      source.id,
      destination.id,
      'UZS',
      '200000.00',
      new Date('2024-06-01'),
    );
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { deletedAt: new Date() },
    });

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('500000.00');
    expect(destinationBalance).toBe('0.00');
  });

  it('N — respects asOfDate for a TRANSFER: a transfer dated after asOfDate is excluded from both accounts', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '500000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    await transfer(userCId, source.id, destination.id, 'UZS', '200000.00', new Date('2024-07-15'));

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('500000.00');
    expect(destinationBalance).toBe('0.00');
  });

  it('O — ACCOUNTING INVARIANT (same-currency only): a transfer conserves the combined balance of both accounts exactly — source decrease + destination increase = 0 net effect', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '1000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '500.00');
    await transfer(userCId, source.id, destination.id, 'UZS', '300.00', new Date('2024-06-01'));

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('700.00'); // 1000 - 300
    expect(destinationBalance).toBe('800.00'); // 500 + 300
    // combined before = 1000 + 500 = 1500; combined after = 700 + 800 = 1500
    expect(Number(sourceBalance) + Number(destinationBalance)).toBe(1500);
  });

  it('P — cross-currency transfer with the exact figures given in this stage’s spec (100 USD -> 1,200,000 UZS); combined-balance conservation is deliberately NOT asserted here (differing currencies)', async () => {
    const source = await makeAccountFor(userCId, BASE, '1000.00');
    const destination = await makeAccountFor(userCId, QUOTE, '0.00');
    await transfer(
      userCId,
      source.id,
      destination.id,
      BASE,
      '100',
      new Date('2024-06-01'),
      '1200000.00',
    );

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('900.00'); // 1000 - 100 USD
    expect(destinationBalance).toBe('1200000.00'); // 0 + 1,200,000 UZS
  });

  it('Q — multiple transfers accumulate correctly on both the shared destination and repeated source', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '1000000.00');
    const destinationOne = await makeAccountFor(userCId, 'UZS', '0.00');
    const destinationTwo = await makeAccountFor(userCId, 'UZS', '0.00');
    await transfer(
      userCId,
      source.id,
      destinationOne.id,
      'UZS',
      '100000.00',
      new Date('2024-06-01'),
    );
    await transfer(
      userCId,
      source.id,
      destinationTwo.id,
      'UZS',
      '50000.00',
      new Date('2024-06-02'),
    );
    await transfer(
      userCId,
      source.id,
      destinationOne.id,
      'UZS',
      '25000.00',
      new Date('2024-06-03'),
    );

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationOneBalance = await as(userCId, () =>
      accountRepository.computeBalance(destinationOne.id, userCId, new Date('2024-06-30')),
    );
    const destinationTwoBalance = await as(userCId, () =>
      accountRepository.computeBalance(destinationTwo.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('825000.00'); // 1000000 - 100000 - 50000 - 25000
    expect(destinationOneBalance).toBe('125000.00'); // 100000 + 25000
    expect(destinationTwoBalance).toBe('50000.00');
  });

  it('R — a TRANSFER coexists correctly with EXPENSE/INCOME on the same account (the pre-existing CASE branches and the new TRANSFER branches never interfere)', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '1000000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    await spend(userCId, source.id, 'UZS', '50000.00', new Date('2024-06-01'), 'EXPENSE');
    await transfer(userCId, source.id, destination.id, 'UZS', '200000.00', new Date('2024-06-02'));
    await spend(userCId, destination.id, 'UZS', '30000.00', new Date('2024-06-03'), 'INCOME');

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('750000.00'); // 1000000 - 50000 (EXPENSE) - 200000 (transfer-out)
    expect(destinationBalance).toBe('230000.00'); // 0 + 200000 (transfer-in) + 30000 (INCOME)
  });

  it('S — respects asOfDate for a TRANSFER in both directions: an old transfer is included, a later one dated after asOfDate is excluded', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '1000000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    await transfer(userCId, source.id, destination.id, 'UZS', '100000.00', new Date('2024-06-01'));
    await transfer(userCId, source.id, destination.id, 'UZS', '999999.00', new Date('2024-07-15'));

    const sourceBalance = await as(userCId, () =>
      accountRepository.computeBalance(source.id, userCId, new Date('2024-06-30')),
    );
    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(sourceBalance).toBe('900000.00'); // only the June transfer counted
    expect(destinationBalance).toBe('100000.00');
  });

  it('T — ownership isolation: a different user cannot compute the balance of an account participating in someone else’s TRANSFER', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '500000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    await transfer(userCId, source.id, destination.id, 'UZS', '200000.00', new Date('2024-06-01'));

    await expect(
      as(userDId, () =>
        accountRepository.computeBalance(destination.id, userDId, new Date('2024-06-30')),
      ),
    ).resolves.toBeNull();
  });

  it('U — an archived (not soft-deleted) account that received a TRANSFER remains historically computable, never silently zeroed', async () => {
    const source = await makeAccountFor(userCId, 'UZS', '500000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');
    await transfer(userCId, source.id, destination.id, 'UZS', '200000.00', new Date('2024-06-01'));
    await as(userCId, () => accountRepository.archive(destination.id, userCId));

    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(destinationBalance).toBe('200000.00');
  });

  it('V — concurrency: two simultaneous transfers into the same destination account both land, and the computed balance correctly reflects both (no lost read — balance is a live SUM over independently inserted rows, not a stored counter)', async () => {
    const sourceOne = await makeAccountFor(userCId, 'UZS', '500000.00');
    const sourceTwo = await makeAccountFor(userCId, 'UZS', '500000.00');
    const destination = await makeAccountFor(userCId, 'UZS', '0.00');

    await Promise.all([
      transfer(userCId, sourceOne.id, destination.id, 'UZS', '100000.00', new Date('2024-06-01')),
      transfer(userCId, sourceTwo.id, destination.id, 'UZS', '150000.00', new Date('2024-06-01')),
    ]);

    const destinationBalance = await as(userCId, () =>
      accountRepository.computeBalance(destination.id, userCId, new Date('2024-06-30')),
    );

    expect(destinationBalance).toBe('250000.00'); // both concurrent transfers landed
  });
});

describe('PrismaAccountRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-007 account-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});

import { InvalidTransactionError } from '@afa/domain';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAccountRepository } from './prisma-account.repository';
import { PrismaTransactionRepository } from './prisma-transaction.repository';

/**
 * Requires `docker compose up -d postgres` with migrations applied and
 * `prisma db seed` run (see repo root README / TASK-DB-002) вЂ” same
 * precondition as prisma-user.repository.integration.spec.ts. Uses a
 * dedicated test user (far-out telegram_user_id, matching that file's
 * collision-avoidance convention) so this suite owns its own transactions
 * end to end and cleans up after itself.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_TELEGRAM_USER_ID = 900_000_000_101n;
const CURRENCY_CODE = 'UZS';

describe('PrismaTransactionRepository (integration)', () => {
  const prisma = new PrismaService();
  // TASK-DB-010 вЂ” this suite never establishes a user context (it tests
  // CRUD/mapping correctness against the owner role, not RLS enforcement вЂ”
  // see rls-user-context.integration.spec.ts for that), so `create()`'s
  // manual RLS set_config is a no-op here either way; both constructor
  // params can safely be the same unextended client this file already uses.
  const repository = new PrismaTransactionRepository(prisma, prisma);
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    await prisma.onModuleInit();

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'FIN-001 Part 3 Test' },
      update: {},
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error(
        'No active expense category found вЂ” run `prisma db seed` before this suite.',
      );
    }
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  it('creates an EXPENSE transaction (AC-EXP-001)', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '45000.99',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-15'),
      description: 'Lunch',
      originalText: 'spent 45000.99 on lunch',
      sourceType: 'text',
      createdBy: 'ai',
    });

    expect(created.transactionType).toBe('EXPENSE');
    expect(created.amount).toBe('45000.99');
    expect(created.id).toBeTruthy();
  });

  it('creates an INCOME transaction and preserves tags/merchant/payment method', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'INCOME',
      amount: '200000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-16'),
      description: 'Client payment',
      originalText: 'got 200000 from a client',
      sourceType: 'text',
      createdBy: 'ai',
      merchant: 'Acme Corp',
      paymentMethod: 'bank_transfer',
      tags: ['freelance', 'client-a'],
    });

    expect(created.merchant).toBe('Acme Corp');
    expect(created.paymentMethod).toBe('bank_transfer');
    expect(created.tags).toEqual(['freelance', 'client-a']);
  });

  it('finds a transaction by id', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '1000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-17'),
      description: 'Coffee',
      originalText: 'coffee 1000',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });

    const found = await repository.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.description).toBe('Coffee');
  });

  it('finds transactions scoped to a user, excluding another userвЂ™s rows', async () => {
    const otherUser = await prisma.user.create({
      data: { telegramUserId: TEST_TELEGRAM_USER_ID + 1n },
    });
    try {
      await repository.create({
        userId: otherUser.id,
        transactionType: 'EXPENSE',
        amount: '5000',
        currency: CURRENCY_CODE,
        categoryId,
        transactionDate: new Date('2026-01-17'),
        description: 'Someone elseвЂ™s expense',
        originalText: 'someone else',
        sourceType: 'manual',
        createdBy: 'user_manual',
      });

      const mine = await repository.findByUserId(userId);
      expect(mine.every((t) => t.userId === userId)).toBe(true);

      const theirs = await repository.findByUserId(otherUser.id);
      expect(theirs).toHaveLength(1);
      expect(theirs[0]?.userId).toBe(otherUser.id);
    } finally {
      await prisma.transaction.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    }
  });

  it('updates a transaction without breaking the partition key (AC-EXP-002)', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '2000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-18'),
      description: 'Original',
      originalText: 'original',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });

    const updated = await repository.update(created.id, { amount: '2500', description: 'Updated' });
    expect(updated.amount).toBe('2500');
    expect(updated.description).toBe('Updated');
  });

  it('soft-deletes and restores a transaction, preserving all original fields (FR-EXP-006/AC-EXP-003)', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '3000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-19'),
      description: 'To be deleted',
      originalText: 'to be deleted',
      sourceType: 'manual',
      createdBy: 'user_manual',
      tags: ['test'],
    });

    const deleted = await repository.softDelete(created.id);
    expect(deleted).not.toBeNull();
    expect(deleted?.isDeleted).toBe(true);

    const restored = await repository.restore(created.id);
    expect(restored).not.toBeNull();
    expect(restored?.isDeleted).toBe(false);
    expect(restored?.amount).toBe('3000');
    expect(restored?.description).toBe('To be deleted');
    expect(restored?.tags).toEqual(['test']);
  });

  it('TASK-BOT-007-FIX вЂ” a second softDelete against an already-deleted row returns null, never a second write (BR-BOT-001-adjacent)', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '4000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-19'),
      description: 'Double-delete guard check',
      originalText: 'double delete guard check',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });

    const first = await repository.softDelete(created.id);
    expect(first).not.toBeNull();

    const second = await repository.softDelete(created.id);
    expect(second).toBeNull();
  });

  it('preserves decimal precision through a full round trip (DB-P3/FR-DB-027)', async () => {
    const created = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '123456789012.34',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-20'),
      description: 'Precision check',
      originalText: 'precision check',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });

    const found = await repository.findById(created.id);
    expect(found?.amount).toBe('123456789012.34');
  });

  it('preserves a linked transaction across the composite partition FK (FR-INC-003)', async () => {
    const original = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '150000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-21'),
      description: 'Shoes',
      originalText: 'bought shoes 150000',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });

    const refund = await repository.create({
      userId,
      transactionType: 'REFUND',
      amount: '150000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-22'),
      description: 'Shoe refund',
      originalText: 'refund for shoes',
      sourceType: 'manual',
      createdBy: 'user_manual',
      linkedTransactionId: original.id,
    });

    expect(refund.linkedTransactionId).toBe(original.id);
  });
});

/**
 * TASK-FIN-004 (Stage B) вЂ” real-Postgres proof that the four new columns
 * (`sourceAccountId`/`destinationAccountId`/`destinationAmount`/`goalId`)
 * persist and round-trip correctly through `PrismaTransactionRepository`.
 *
 * Deliberately uses an explicit owner-role connection (`DIRECT_URL ??
 * DATABASE_URL`, matching `prisma-debt.repository.integration.spec.ts`'s/
 * `prisma-loan.repository.integration.spec.ts`'s own established pattern),
 * NOT the bare `new PrismaService()` the pre-existing suite above this one
 * uses. That distinction turned out to matter for real while building this
 * stage: this environment's plain `DATABASE_URL` connects as the
 * RLS-restricted `app_user` role via a pooler, and `PrismaTransactionRepository.create()`
 * only sets `app.current_user_id` when `getCurrentUserId()` (AsyncLocalStorage)
 * has an active value вЂ” which the pre-existing suite above never
 * establishes. Running the FULL real-Postgres regression this stage
 * confirmed that gap is genuinely pre-existing and NOT something this
 * stage introduced (see this stage's final report, section 7) вЂ” it is not
 * fixed here, since it is outside TASK-FIN-004's own scope; this new
 * describe block simply avoids inheriting it by using the correct,
 * already-established owner-role pattern from the start.
 *
 * `Account`/`SavingsGoal` fixture rows are created via raw
 * `prisma.account.create()`/`prisma.savingsGoal.create()` (this file's own
 * established "raw Prisma for fixture setup" convention, mirroring how
 * `categoryId` is fetched above) rather than through their own repositories,
 * to keep this file's fixture setup self-contained.
 *
 * CATEGORY ID OPEN ISSUE (per the Stage B go-ahead): a real, valid
 * `categoryId` is required by the unchanged NOT NULL FK вЂ” the same
 * `categoryId` fixture already established above is reused here. This
 * proves the repository/persistence layer is fully type- and FK-correct
 * without resolving what category a production TRANSFER/GOAL_CONTRIBUTION
 * should actually use вЂ” that semantic decision remains open, flagged for
 * TASK-FIN-004 Stage C/D, not decided here.
 */
describe('PrismaTransactionRepository вЂ” TASK-FIN-004 TRANSFER/GOAL_CONTRIBUTION persistence (integration)', () => {
  const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const repository = new PrismaTransactionRepository(prisma, prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const TEST_TELEGRAM_USER_ID = 900_000_000_944n;
  const CURRENCY_UZS = 'UZS';
  const CURRENCY_USD = 'USD';

  let userId: string;
  let categoryId: string;
  let sourceAccountId: string;
  let destinationAccountId: string;
  let usdAccountId: string;
  let goalId: string;
  let createdTransactionIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'TASK-FIN-004 Transfer Test' },
      update: {},
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error(
        'No active expense category found вЂ” run `prisma db seed` before this suite.',
      );
    }
    categoryId = category.id;

    const sourceAccount = await prisma.account.create({
      data: {
        userId,
        name: 'Cash',
        accountType: 'cash',
        currency: CURRENCY_UZS,
        startingBalance: '0',
      },
    });
    sourceAccountId = sourceAccount.id;

    const destinationAccount = await prisma.account.create({
      data: {
        userId,
        name: 'Bank Card',
        accountType: 'bank_card',
        currency: CURRENCY_UZS,
        startingBalance: '0',
      },
    });
    destinationAccountId = destinationAccount.id;

    const usdAccount = await prisma.account.create({
      data: {
        userId,
        name: 'USD Savings',
        accountType: 'savings',
        currency: CURRENCY_USD,
        startingBalance: '0',
      },
    });
    usdAccountId = usdAccount.id;

    const goal = await prisma.savingsGoal.create({
      data: { userId, name: 'Vacation fund', targetAmount: '5000000.00', currency: CURRENCY_UZS },
    });
    goalId = goal.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    createdTransactionIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.savingsGoal.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  it('A вЂ” persists a same-currency TRANSFER (AC-FIN-002)', async () => {
    const transfer = await repository.create({
      userId,
      transactionType: 'TRANSFER',
      amount: '45000.00',
      currency: CURRENCY_UZS,
      sourceAccountId,
      destinationAccountId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Move cash to bank',
      originalText: 'moved 45000 from cash to bank',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(transfer.id);

    expect(transfer.transactionType).toBe('TRANSFER');
    expect(transfer.sourceAccountId).toBe(sourceAccountId);
    expect(transfer.destinationAccountId).toBe(destinationAccountId);
    expect(transfer.accountId).toBeNull();
    expect(transfer.destinationAmount).toBeNull();

    const found = await repository.findById(transfer.id);
    expect(found?.sourceAccountId).toBe(sourceAccountId);
    expect(found?.destinationAccountId).toBe(destinationAccountId);
  });

  it('B вЂ” persists a cross-currency TRANSFER with destinationAmount (FR-FIN-005), preserving full decimal precision', async () => {
    const transfer = await repository.create({
      userId,
      transactionType: 'TRANSFER',
      amount: '1000000.00',
      currency: CURRENCY_UZS,
      destinationAmount: '81.23',
      sourceAccountId,
      destinationAccountId: usdAccountId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Move UZS cash to USD savings',
      originalText: 'moved 1000000 UZS to USD savings, received 81.23 USD',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(transfer.id);

    expect(transfer.destinationAmount).toBe('81.23');

    const found = await repository.findById(transfer.id);
    expect(found?.destinationAmount).toBe('81.23');
  });

  it('C вЂ” rejects a TRANSFER using the same account as source and destination, with ZERO rows persisted (В§8.7.5, AC-FIN-007)', async () => {
    const originalText = `same-account-reject-${Date.now()}`;

    await expect(
      repository.create({
        userId,
        transactionType: 'TRANSFER',
        amount: '10000.00',
        currency: CURRENCY_UZS,
        sourceAccountId,
        destinationAccountId: sourceAccountId,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'Invalid self-transfer',
        originalText,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    ).rejects.toThrow(InvalidTransactionError);

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it('D вЂ” persists a standalone GOAL_CONTRIBUTION (AC-FIN-004)', async () => {
    const contribution = await repository.create({
      userId,
      transactionType: 'GOAL_CONTRIBUTION',
      amount: '250000.00',
      currency: CURRENCY_UZS,
      goalId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Contribution toward vacation fund',
      originalText: 'put aside 250000 for vacation',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(contribution.id);

    expect(contribution.transactionType).toBe('GOAL_CONTRIBUTION');
    expect(contribution.goalId).toBe(goalId);
    expect(contribution.sourceAccountId).toBeNull();
    expect(contribution.destinationAccountId).toBeNull();

    const found = await repository.findById(contribution.id);
    expect(found?.goalId).toBe(goalId);
  });

  it('E вЂ” persists a TRANSFER optionally linked to a savings goal (approved "linked transfer" contribution mode, FR-FIN-012)', async () => {
    const transfer = await repository.create({
      userId,
      transactionType: 'TRANSFER',
      amount: '300000.00',
      currency: CURRENCY_UZS,
      sourceAccountId,
      destinationAccountId,
      goalId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Transfer into savings-designated account, linked to goal',
      originalText: 'transferred 300000 toward vacation fund via bank transfer',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(transfer.id);

    expect(transfer.goalId).toBe(goalId);
    expect(transfer.sourceAccountId).toBe(sourceAccountId);
  });

  it('F вЂ” rejects a GOAL_CONTRIBUTION missing goalId, with ZERO rows persisted', async () => {
    const originalText = `missing-goal-reject-${Date.now()}`;

    await expect(
      repository.create({
        userId,
        transactionType: 'GOAL_CONTRIBUTION',
        amount: '10000.00',
        currency: CURRENCY_UZS,
        categoryId,
        transactionDate: new Date('2026-08-17'),
        description: 'Invalid contribution',
        originalText,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    ).rejects.toThrow(InvalidTransactionError);

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it('G вЂ” TASK-FIN-004 (FR-FIN-006): editing a same-currency TRANSFERвЂ™s amount via update() is automatically reflected in both accountsвЂ™ computeBalance(), with zero separate reconciliation code', async () => {
    const asOfDate = new Date('2026-08-18');
    const transfer = await repository.create({
      userId,
      transactionType: 'TRANSFER',
      amount: '100000.00',
      currency: CURRENCY_UZS,
      sourceAccountId,
      destinationAccountId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Move cash to bank',
      originalText: `fr-fin-006-edit-same-currency-${Date.now()}`,
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(transfer.id);

    expect(await accountRepository.computeBalance(sourceAccountId, userId, asOfDate)).toBe(
      '-100000.00',
    );
    expect(await accountRepository.computeBalance(destinationAccountId, userId, asOfDate)).toBe(
      '100000.00',
    );

    await repository.update(transfer.id, { amount: '150000.00' });

    expect(await accountRepository.computeBalance(sourceAccountId, userId, asOfDate)).toBe(
      '-150000.00',
    );
    expect(await accountRepository.computeBalance(destinationAccountId, userId, asOfDate)).toBe(
      '150000.00',
    );
  });

  it('H вЂ” TASK-FIN-004 (FR-FIN-006): editing a cross-currency TRANSFERвЂ™s amount+destinationAmount together via update() is automatically reflected in both accountsвЂ™ computeBalance()', async () => {
    const asOfDate = new Date('2026-08-18');
    const transfer = await repository.create({
      userId,
      transactionType: 'TRANSFER',
      amount: '1000000.00',
      currency: CURRENCY_UZS,
      destinationAmount: '80.00',
      sourceAccountId,
      destinationAccountId: usdAccountId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Move UZS cash to USD savings',
      originalText: `fr-fin-006-edit-cross-currency-${Date.now()}`,
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(transfer.id);

    expect(await accountRepository.computeBalance(sourceAccountId, userId, asOfDate)).toBe(
      '-1000000.00',
    );
    expect(await accountRepository.computeBalance(usdAccountId, userId, asOfDate)).toBe('80.00');

    await repository.update(transfer.id, { amount: '1200000.00', destinationAmount: '95.00' });

    expect(await accountRepository.computeBalance(sourceAccountId, userId, asOfDate)).toBe(
      '-1200000.00',
    );
    expect(await accountRepository.computeBalance(usdAccountId, userId, asOfDate)).toBe('95.00');
  });

  it('I — TASK-FIN-008 (precision-bug fix): a full 8-decimal-place exchangeRateToDefault survives create()/findById() without truncation to 2 decimals', async () => {
    const expense = await repository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '10.00',
      currency: 'USD',
      exchangeRateToDefault: '0.12345678',
      accountId: sourceAccountId,
      categoryId,
      transactionDate: new Date('2026-08-17'),
      description: 'Cross-currency precision regression check',
      originalText: `fr-fin-008-exchange-rate-precision-${Date.now()}`,
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    createdTransactionIds.push(expense.id);

    expect(expense.exchangeRateToDefault).toBe('0.12345678');

    const found = await repository.findById(expense.id);
    expect(found?.exchangeRateToDefault).toBe('0.12345678');
  });
});

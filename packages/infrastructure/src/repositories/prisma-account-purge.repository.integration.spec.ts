import { Buffer } from 'node:buffer';
import { ObjectStorageUnavailableError, type ObjectStoragePort } from '@afa/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAccountPurgeRepository } from './prisma-account-purge.repository';

/**
 * Requires `docker compose up -d postgres` with migrations applied and
 * `prisma db seed` run (same precondition as
 * `prisma-user.repository.integration.spec.ts`/`prisma-transaction.repository.integration.spec.ts`).
 * Runs against the raw, unextended `PrismaService` (same established
 * precedent every other integration spec in this file uses) — `afa_owner`
 * is the table-owning role and is not subject to RLS regardless of the
 * extension; correctness here is verified by the explicit `userId`/
 * FK-chain-derived `where` filters `PrismaAccountPurgeRepository` itself
 * uses, which is exactly the mechanism this test is checking.
 *
 * Builds one fixture user with at least one row in EVERY table the FK-safe
 * purge order touches (§`prisma-account-purge.repository.ts`'s own doc
 * comment), plus a second, untouched control user, to verify: every listed
 * table is actually emptied for the purged user, no FK-violation is ever
 * thrown regardless of order, the `users` row is hard-deleted, exactly one
 * `audit_log` system entry is left behind with the right `target_user_id`,
 * and the control user's own data is completely unaffected.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const CURRENCY_CODE = 'UZS';

class ControllableFakeObjectStorage implements ObjectStoragePort {
  shouldFail = false;
  async getObject(): Promise<Buffer> {
    throw new Error('not used in this test');
  }
  async putObject(): Promise<void> {
    // not used in this test
  }
  async deleteObject(): Promise<void> {
    // not used in this test
  }
  async deleteObjectsByPrefix(): Promise<void> {
    if (this.shouldFail) {
      throw new ObjectStorageUnavailableError();
    }
  }
}

async function buildFullFixtureUser(
  prisma: PrismaService,
  telegramUserId: bigint,
  categoryId: string,
) {
  const user = await prisma.user.create({
    data: { telegramUserId, displayName: 'Purge Fixture User', status: 'pending_deletion' },
  });
  const userId = user.id;

  const account = await prisma.account.create({
    data: { userId, name: 'Main Wallet', accountType: 'cash', currency: CURRENCY_CODE },
  });
  const goal = await prisma.savingsGoal.create({
    data: { userId, name: 'Rainy Day', targetAmount: '1000000', currency: CURRENCY_CODE },
  });
  const counterparty = await prisma.counterparty.create({
    data: { userId, name: `Purge Test Counterparty ${userId.slice(0, 8)}` },
  });
  const debt = await prisma.debt.create({
    data: {
      userId,
      direction: 'owed_to_me',
      counterpartyName: counterparty.name,
      counterpartyRefId: counterparty.id,
      originalAmount: '50000',
      outstandingBalance: '50000',
      currency: CURRENCY_CODE,
      transactionDate: new Date('2026-01-01'),
      originalText: 'fixture debt',
    },
  });
  await prisma.debtRepayment.create({
    data: {
      debtId: debt.id,
      amount: '10000',
      currency: CURRENCY_CODE,
      repaymentDate: new Date('2026-01-10'),
      originalText: 'fixture repayment',
    },
  });
  const budget = await prisma.budget.create({
    data: {
      userId,
      scopeType: 'overall',
      limitAmount: '500000',
      currency: CURRENCY_CODE,
      periodType: 'monthly',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-01-31'),
    },
  });
  await prisma.budgetNotificationLog.create({
    data: { budgetId: budget.id, thresholdFired: 80, periodStart: new Date('2026-01-01') },
  });
  const loan = await prisma.loan.create({
    data: {
      userId,
      lender: 'Fixture Bank',
      principalAmount: '1000000',
      outstandingBalance: '1000000',
      currency: CURRENCY_CODE,
      installmentAmount: '100000',
      installmentFrequency: 'monthly',
      startDate: new Date('2026-01-01'),
    },
  });
  await prisma.loanPayment.create({
    data: {
      loanId: loan.id,
      amount: '100000',
      principalPortion: '90000',
      paymentDate: new Date('2026-02-01'),
    },
  });

  const txnDate = new Date('2026-01-15');
  const linkedTxn = await prisma.transaction.create({
    data: {
      userId,
      transactionType: 'EXPENSE',
      amount: '1000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: txnDate,
      description: 'fixture linked leg',
      originalText: 'fixture',
      sourceType: 'text',
      createdBy: 'ai',
    },
  });
  const mainTxn = await prisma.transaction.create({
    data: {
      userId,
      transactionType: 'EXPENSE',
      amount: '25000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: txnDate,
      description: 'fixture main transaction',
      originalText: 'fixture',
      sourceType: 'text',
      createdBy: 'ai',
      accountId: account.id,
      goalId: goal.id,
      linkedTransactionId: linkedTxn.id,
      linkedTransactionDate: linkedTxn.transactionDate,
    },
  });
  await prisma.transactionAuditLog.create({
    data: {
      transactionId: mainTxn.id,
      transactionDate: mainTxn.transactionDate,
      fieldName: 'amount',
      oldValue: '20000',
      newValue: '25000',
      changedBy: 'ai',
    },
  });
  await prisma.transactionDraft.create({
    data: {
      userId,
      partialData: {},
      missingFields: [],
      originalText: 'fixture draft',
      sourceType: 'text',
      resolvedTransactionId: mainTxn.id,
      resolvedTransactionDate: mainTxn.transactionDate,
    },
  });
  await prisma.scheduledTransaction.create({
    data: {
      userId,
      transactionData: {},
      scheduledDate: new Date('2026-02-15'),
      resolvedTransactionId: mainTxn.id,
      resolvedTransactionDate: mainTxn.transactionDate,
    },
  });
  await prisma.recurringTemplate.create({
    data: {
      userId,
      templateData: {},
      cadence: 'monthly',
      nextOccurrenceDate: new Date('2026-02-01'),
    },
  });
  await prisma.notification.create({
    data: { userId, type: 'debt_due_approaching', payload: {}, status: 'pending' },
  });
  await prisma.userSetting.create({
    data: { userId, settingKey: 'reminders_enabled', settingValue: true },
  });
  await prisma.userFinancialSummary.create({ data: { userId } });
  const customCategory = await prisma.category.create({
    data: {
      code: `purge-test-custom-${userId.slice(0, 8)}`,
      defaultType: 'expense',
      isSystem: false,
      ownerUserId: userId,
    },
  });

  return { user, customCategoryId: customCategory.id };
}

describe('PrismaAccountPurgeRepository (integration)', () => {
  const prisma = new PrismaService();
  let categoryId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active', isSystem: true },
    });
    if (!category) {
      throw new Error(
        'No active system expense category found — run `prisma db seed` before this suite.',
      );
    }
    categoryId = category.id;
  });

  afterAll(async () => {
    // Best-effort cleanup — a fully successful purge already removes
    // everything for a given user id; this only matters if an assertion
    // fails partway through and leaves fixture rows behind.
    for (const userId of createdUserIds) {
      await prisma.userFinancialSummary.deleteMany({ where: { userId } });
      await prisma.userSetting.deleteMany({ where: { userId } });
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.recurringTemplate.deleteMany({ where: { userId } });
      await prisma.scheduledTransaction.deleteMany({ where: { userId } });
      await prisma.transactionDraft.deleteMany({ where: { userId } });
      await prisma.transactionAuditLog.deleteMany({
        where: { transaction: { userId } },
      });
      await prisma.transaction.deleteMany({ where: { userId } });
      await prisma.debtRepayment.deleteMany({ where: { debt: { userId } } });
      await prisma.debt.deleteMany({ where: { userId } });
      await prisma.budgetNotificationLog.deleteMany({ where: { budget: { userId } } });
      await prisma.budget.deleteMany({ where: { userId } });
      await prisma.loanPayment.deleteMany({ where: { loan: { userId } } });
      await prisma.loan.deleteMany({ where: { userId } });
      await prisma.account.deleteMany({ where: { userId } });
      await prisma.savingsGoal.deleteMany({ where: { userId } });
      await prisma.counterparty.deleteMany({ where: { userId } });
      await prisma.category.deleteMany({ where: { ownerUserId: userId } });
      await prisma.auditLog.deleteMany({ where: { targetUserId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.onModuleDestroy();
  });

  it('purges every FK branch, hard-deletes the users row, writes one audit_log entry, and never touches a control user', async () => {
    const targetTelegramId = 900_000_000_601n + BigInt(Date.now() % 100_000);
    const controlTelegramId = 900_000_000_701n + BigInt(Date.now() % 100_000);

    const { user: targetUser } = await buildFullFixtureUser(prisma, targetTelegramId, categoryId);
    const { user: controlUser } = await buildFullFixtureUser(prisma, controlTelegramId, categoryId);
    createdUserIds.push(targetUser.id, controlUser.id);

    const objectStorage = new ControllableFakeObjectStorage();
    const repository = new PrismaAccountPurgeRepository(prisma, objectStorage);

    const outcome = await repository.purgeUser(
      { id: targetUser.id, telegramUserId: targetUser.telegramUserId, preferredLanguage: 'en' },
      new Date(),
    );

    expect(outcome.kind).toBe('purged');
    if (outcome.kind !== 'purged') return;

    expect(outcome.counts).toEqual({
      debtRepayments: 1,
      budgetNotificationLog: 1,
      loanPayments: 1,
      transactionAuditLog: 1,
      transactionDrafts: 1,
      scheduledTransactions: 1,
      transactions: 2,
      debts: 1,
      budgets: 1,
      loans: 1,
      accounts: 1,
      savingsGoals: 1,
      counterparties: 1,
      recurringTemplates: 1,
      notifications: 1,
      userSettings: 1,
      userFinancialSummary: 1,
      customCategories: 1,
    });

    // The users row itself — hard-deleted, no soft "deleted" marker left.
    expect(await prisma.user.findUnique({ where: { id: targetUser.id } })).toBeNull();

    // Every table touched — verify zero rows remain for the purged user.
    expect(await prisma.transaction.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.transactionDraft.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.scheduledTransaction.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.debt.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.budget.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.loan.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.savingsGoal.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.counterparty.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.recurringTemplate.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.userSetting.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.userFinancialSummary.count({ where: { userId: targetUser.id } })).toBe(0);
    expect(await prisma.category.count({ where: { ownerUserId: targetUser.id } })).toBe(0);

    // The one system audit_log entry — never purged, correctly attributed.
    const auditEntries = await prisma.auditLog.findMany({ where: { targetUserId: targetUser.id } });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      actorType: 'system',
      actorId: null,
      action: 'account_purge',
      targetUserId: targetUser.id,
      targetResource: 'users',
    });

    // The control user is completely untouched.
    expect(await prisma.user.findUnique({ where: { id: controlUser.id } })).not.toBeNull();
    expect(await prisma.transaction.count({ where: { userId: controlUser.id } })).toBe(2);
    expect(await prisma.debt.count({ where: { userId: controlUser.id } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: controlUser.id } })).toBe(1);
  }, 30_000);

  it('storage_failure leaves the users row and every already-purged Postgres row exactly as-is, and a retry after the storage backend recovers completes the purge', async () => {
    const telegramId = 900_000_000_801n + BigInt(Date.now() % 100_000);
    const { user } = await buildFullFixtureUser(prisma, telegramId, categoryId);
    createdUserIds.push(user.id);

    const objectStorage = new ControllableFakeObjectStorage();
    objectStorage.shouldFail = true;
    const repository = new PrismaAccountPurgeRepository(prisma, objectStorage);
    const candidate = { id: user.id, telegramUserId: user.telegramUserId, preferredLanguage: 'en' };

    const firstOutcome = await repository.purgeUser(candidate, new Date());
    expect(firstOutcome).toEqual({ kind: 'storage_failure', candidate });

    // Postgres data is already gone (idempotent per-table deletes ran
    // before the storage step) — but the users row is deliberately left in
    // place, since storage cleanup did not succeed.
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.debt.count({ where: { userId: user.id } })).toBe(0);
    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe('pending_deletion');
    expect(await prisma.auditLog.count({ where: { targetUserId: user.id } })).toBe(0);

    objectStorage.shouldFail = false;
    const secondOutcome = await repository.purgeUser(candidate, new Date());
    expect(secondOutcome.kind).toBe('purged');
    if (secondOutcome.kind !== 'purged') return;
    // Every count is 0 the second time — everything real was already swept
    // away on the first attempt; this run is a safe, idempotent no-op sweep
    // that only completes the final two irreversible steps.
    expect(Object.values(secondOutcome.counts).every((count) => count === 0)).toBe(true);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { targetUserId: user.id } })).toBe(1);
  }, 30_000);
});

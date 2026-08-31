import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaExpenseHistoryRepository } from './prisma-expense-history.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaTransactionRepository } from './prisma-transaction.repository';

/**
 * Requires `docker compose up -d postgres` with migrations applied and
 * `prisma db seed` run — same precondition as the sibling integration
 * specs in this package.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_TELEGRAM_USER_ID = 900_000_000_301n;
const CURRENCY_CODE = 'UZS';

describe('PrismaExpenseHistoryRepository (integration)', () => {
  const prisma = new PrismaService();
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const repository = new PrismaExpenseHistoryRepository(prisma);
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'FR-EXP-004 Test' },
      update: {},
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  it('returns null when there is no matching history', async () => {
    await expect(
      repository.getTrailingAverageExpenseAmount(userId, CURRENCY_CODE, new Date()),
    ).resolves.toBeNull();
  });

  it('averages only EXPENSE-type, same-currency, non-deleted transactions within the last 90 days', async () => {
    const asOf = new Date('2026-06-01T00:00:00Z');

    // Counts toward the average.
    await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '10000',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-05-15'),
      description: 'In window',
      originalText: 'in window',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    // Excluded: INCOME, not EXPENSE.
    await transactionRepository.create({
      userId,
      transactionType: 'INCOME',
      amount: '999999',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-05-15'),
      description: 'Income, excluded',
      originalText: 'income excluded',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    // Excluded: older than 90 days relative to asOf.
    await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '999999',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-01-01'),
      description: 'Too old, excluded',
      originalText: 'too old',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    // Excluded: different currency.
    await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '999999',
      currency: 'USD',
      categoryId,
      transactionDate: new Date('2026-05-15'),
      description: 'Different currency, excluded',
      originalText: 'different currency',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    // Excluded: soft-deleted.
    const deletedOne = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '999999',
      currency: CURRENCY_CODE,
      categoryId,
      transactionDate: new Date('2026-05-15'),
      description: 'Deleted, excluded',
      originalText: 'deleted',
      sourceType: 'manual',
      createdBy: 'user_manual',
    });
    await transactionRepository.softDelete(deletedOne.id);

    const average = await repository.getTrailingAverageExpenseAmount(userId, CURRENCY_CODE, asOf);
    expect(average).toBe('10000');
  });
});

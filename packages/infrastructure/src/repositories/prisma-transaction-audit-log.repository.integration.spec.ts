import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaTransactionAuditLogRepository } from './prisma-transaction-audit-log.repository';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_TELEGRAM_USER_ID = 900_000_000_102n;

describe('PrismaTransactionAuditLogRepository (integration)', () => {
  const prisma = new PrismaService();
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const auditLogRepository = new PrismaTransactionAuditLogRepository(prisma);
  let userId: string;
  let transactionId: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'FIN-001 Part 3 Audit Test' },
      update: {},
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }

    const created = await transactionRepository.create({
      userId,
      transactionType: 'EXPENSE',
      amount: '45000',
      currency: 'UZS',
      categoryId: category.id,
      transactionDate: new Date('2026-01-15'),
      description: 'Lunch',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
      createdBy: 'ai',
    });
    transactionId = created.id;
  });

  afterAll(async () => {
    await prisma.transactionAuditLog.deleteMany({ where: { transactionId } });
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  it('records a single audit entry with old and new values (FR-EXP-007)', async () => {
    const changedAt = new Date();
    await auditLogRepository.record([
      {
        transactionId,
        fieldName: 'amount',
        oldValue: '45000',
        newValue: '50000',
        changedBy: 'user_edit',
        changedAt,
      },
    ]);

    const rows = await prisma.transactionAuditLog.findMany({
      where: { transactionId, fieldName: 'amount' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldValue).toBe('45000');
    expect(rows[0]?.newValue).toBe('50000');
    expect(rows[0]?.changedBy).toBe('user_edit');
  });

  it('preserves a null oldValue (e.g. a field set for the first time)', async () => {
    await auditLogRepository.record([
      {
        transactionId,
        fieldName: 'merchant',
        oldValue: null,
        newValue: 'Cafe X',
        changedBy: 'user_edit',
        changedAt: new Date(),
      },
    ]);

    const row = await prisma.transactionAuditLog.findFirst({
      where: { transactionId, fieldName: 'merchant' },
    });
    expect(row?.oldValue).toBeNull();
    expect(row?.newValue).toBe('Cafe X');
  });

  it('preserves a null newValue (e.g. deleted_at on restore)', async () => {
    await auditLogRepository.record([
      {
        transactionId,
        fieldName: 'deleted_at',
        oldValue: new Date('2026-01-19').toISOString(),
        newValue: null,
        changedBy: 'undo',
        changedAt: new Date(),
      },
    ]);

    const row = await prisma.transactionAuditLog.findFirst({
      where: { transactionId, fieldName: 'deleted_at' },
    });
    expect(row?.newValue).toBeNull();
    expect(row?.changedBy).toBe('undo');
  });

  it('records one row per changed field for a multi-field edit', async () => {
    const changedAt = new Date();
    await auditLogRepository.record([
      {
        transactionId,
        fieldName: 'description',
        oldValue: 'Lunch',
        newValue: 'Dinner',
        changedBy: 'user_edit',
        changedAt,
      },
      {
        transactionId,
        fieldName: 'location',
        oldValue: null,
        newValue: 'Tashkent',
        changedBy: 'user_edit',
        changedAt,
      },
    ]);

    const rows = await prisma.transactionAuditLog.findMany({
      where: { transactionId, fieldName: { in: ['description', 'location'] } },
    });
    expect(rows).toHaveLength(2);
  });

  it('is a no-op for an empty batch', async () => {
    const before = await prisma.transactionAuditLog.count({ where: { transactionId } });
    await auditLogRepository.record([]);
    const after = await prisma.transactionAuditLog.count({ where: { transactionId } });
    expect(after).toBe(before);
  });
});

import { Prisma, type Transaction as PrismaTransactionRow } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  formatTransactionTime,
  parseTransactionTime,
  toDomainTransaction,
} from './transaction.mapper';

function makeRow(overrides: Partial<PrismaTransactionRow> = {}): PrismaTransactionRow {
  return {
    id: 'txn-1',
    userId: 'user-1',
    transactionType: 'EXPENSE',
    amount: new Prisma.Decimal('45000.99'),
    currency: 'UZS',
    exchangeRateToDefault: null,
    categoryId: 'category-food',
    subcategoryId: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: new Date('2026-01-15'),
    transactionTime: null,
    location: null,
    tags: [],
    description: 'Lunch',
    originalText: 'spent 45000.99 on lunch',
    sourceType: 'text',
    sourceReference: null,
    confidenceScores: null,
    isRecurringDetected: false,
    linkedTransactionId: null,
    linkedTransactionDate: null,
    createdBy: 'ai',
    deletedAt: null,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-01-15T10:00:00Z'),
    accountId: null,
    sourceAccountId: null,
    destinationAccountId: null,
    destinationAmount: null,
    goalId: null,
    ...overrides,
  } as PrismaTransactionRow;
}

describe('formatTransactionTime / parseTransactionTime', () => {
  it('formats a Prisma TIME value as HH:MM:SS', () => {
    expect(formatTransactionTime(new Date('1970-01-01T14:05:09Z'))).toBe('14:05:09');
  });

  it('round-trips through parse then format', () => {
    expect(formatTransactionTime(parseTransactionTime('09:30:00'))).toBe('09:30:00');
  });
});

describe('toDomainTransaction', () => {
  it('preserves decimal precision without float conversion (DB-P3/FR-DB-027)', () => {
    const txn = toDomainTransaction(makeRow({ amount: new Prisma.Decimal('123456789012345.67') }));

    // A JS number cannot represent this value exactly; the string form
    // proves no float round-trip happened.
    expect(txn.amount).toBe('123456789012345.67');
  });

  it('preserves exchangeRateToDefault precision when present, and null when absent', () => {
    const withRate = toDomainTransaction(
      makeRow({ exchangeRateToDefault: new Prisma.Decimal('12345.87654321') }),
    );
    expect(withRate.exchangeRateToDefault).toBe('12345.87654321');

    const withoutRate = toDomainTransaction(makeRow({ exchangeRateToDefault: null }));
    expect(withoutRate.exchangeRateToDefault).toBeNull();
  });

  it('preserves accountId when present, and null when absent (FR-FIN-023)', () => {
    const withAccount = toDomainTransaction(makeRow({ accountId: 'account-1' }));
    expect(withAccount.accountId).toBe('account-1');

    const withoutAccount = toDomainTransaction(makeRow({ accountId: null }));
    expect(withoutAccount.accountId).toBeNull();
  });

  it('preserves tags exactly, including an empty array', () => {
    expect(toDomainTransaction(makeRow({ tags: [] })).tags).toEqual([]);
    expect(toDomainTransaction(makeRow({ tags: ['business', 'shared'] })).tags).toEqual([
      'business',
      'shared',
    ]);
  });

  it('preserves nullable optional fields as null when absent', () => {
    const txn = toDomainTransaction(
      makeRow({
        subcategoryId: null,
        merchant: null,
        paymentMethod: null,
        location: null,
        sourceReference: null,
        confidenceScores: null,
        linkedTransactionId: null,
        transactionTime: null,
      }),
    );

    expect(txn.subcategoryId).toBeNull();
    expect(txn.merchant).toBeNull();
    expect(txn.paymentMethod).toBeNull();
    expect(txn.location).toBeNull();
    expect(txn.sourceReference).toBeNull();
    expect(txn.confidenceScores).toBeNull();
    expect(txn.linkedTransactionId).toBeNull();
    expect(txn.transactionTime).toBeNull();
  });

  it('preserves optional fields when present', () => {
    const txn = toDomainTransaction(
      makeRow({
        subcategoryId: 'sub-1',
        merchant: 'Cafe X',
        paymentMethod: 'cash',
        location: 'Tashkent',
        sourceReference: 's3://bucket/key',
        confidenceScores: { overall: 0.95, amount: 0.99 },
        transactionTime: new Date('1970-01-01T12:30:00Z'),
      }),
    );

    expect(txn.subcategoryId).toBe('sub-1');
    expect(txn.merchant).toBe('Cafe X');
    expect(txn.paymentMethod).toBe('cash');
    expect(txn.location).toBe('Tashkent');
    expect(txn.sourceReference).toBe('s3://bucket/key');
    expect(txn.confidenceScores).toEqual({ overall: 0.95, amount: 0.99 });
    expect(txn.transactionTime).toBe('12:30:00');
  });

  it('preserves a linked transaction id (REFUND, FR-INC-003)', () => {
    const txn = toDomainTransaction(
      makeRow({
        transactionType: 'REFUND',
        linkedTransactionId: 'txn-original',
        description: 'Shoe refund',
      }),
    );

    expect(txn.linkedTransactionId).toBe('txn-original');
  });

  it('preserves createdBy, sourceType, and isRecurringDetected', () => {
    const txn = toDomainTransaction(
      makeRow({ createdBy: 'user_manual', sourceType: 'manual', isRecurringDetected: true }),
    );

    expect(txn.createdBy).toBe('user_manual');
    expect(txn.sourceType).toBe('manual');
    expect(txn.isRecurringDetected).toBe(true);
  });

  it('preserves deletedAt/createdAt/updatedAt timestamps', () => {
    const deletedAt = new Date('2026-02-01T00:00:00Z');
    const txn = toDomainTransaction(makeRow({ deletedAt }));

    expect(txn.deletedAt).toEqual(deletedAt);
    expect(txn.isDeleted).toBe(true);
  });
});

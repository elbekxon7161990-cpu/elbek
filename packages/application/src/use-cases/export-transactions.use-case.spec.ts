import { Buffer } from 'node:buffer';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportTransactionsUseCase } from './export-transactions.use-case';

const range = { start: new Date('2026-08-01'), end: new Date('2026-08-31') };

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'txn-1',
    transactionDate: new Date('2026-08-05'),
    transactionType: 'EXPENSE',
    amount: '10.00',
    currency: 'UZS',
    convertedAmount: null,
    categoryCode: 'FOOD_DINING',
    merchant: 'Store',
    paymentMethod: 'cash',
    tags: ['groceries'],
    description: 'lunch',
    ...overrides,
  };
}

describe('ExportTransactionsUseCase (TASK-FIN-014)', () => {
  let exportQueryRepository: { getTransactionRows: ReturnType<typeof vi.fn> };
  let xlsxGenerator: { generate: ReturnType<typeof vi.fn> };
  let useCase: ExportTransactionsUseCase;

  beforeEach(() => {
    exportQueryRepository = { getTransactionRows: vi.fn() };
    xlsxGenerator = { generate: vi.fn().mockResolvedValue(Buffer.from('xlsx-bytes')) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCase = new ExportTransactionsUseCase(exportQueryRepository as any, xlsxGenerator as any);
  });

  it('test #1 — basic success: generates a workbook and returns its row count', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);

    const outcome = await useCase.execute('user-1', range);

    expect(outcome).toEqual({ kind: 'generated', buffer: Buffer.from('xlsx-bytes'), rowCount: 1 });
    expect(xlsxGenerator.generate).toHaveBeenCalledTimes(1);
  });

  it('test #2 — empty dataset returns kind "empty", never generates a workbook', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([]);

    const outcome = await useCase.execute('user-1', range);

    expect(outcome).toEqual({ kind: 'empty' });
    expect(xlsxGenerator.generate).not.toHaveBeenCalled();
  });

  it('test #3 — user isolation: the authenticated user id is passed straight through to the query, never altered', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);

    await useCase.execute('user-abc-123', range);

    expect(exportQueryRepository.getTransactionRows).toHaveBeenCalledWith(
      'user-abc-123',
      range,
      {},
      expect.any(Number),
    );
  });

  it('test #4 — date-range filtering: the exact range given is forwarded unchanged to the query', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);
    const customRange = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

    await useCase.execute('user-1', customRange);

    expect(exportQueryRepository.getTransactionRows).toHaveBeenCalledWith(
      'user-1',
      customRange,
      {},
      expect.any(Number),
    );
  });

  it('test #5 — existing report filters compatibility: categoryId/transactionType filters forward unchanged', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);
    const filters = { categoryId: 'cat-1', transactionType: 'EXPENSE' as const };

    await useCase.execute('user-1', range, filters);

    expect(exportQueryRepository.getTransactionRows).toHaveBeenCalledWith(
      'user-1',
      range,
      filters,
      expect.any(Number),
    );
  });

  it('test #6/#7 — XLSX structure and required columns: sheet name, exact FR-EXP2-002 column order plus the converted-amount column', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);

    await useCase.execute('user-1', range);

    const [sheets] = xlsxGenerator.generate.mock.calls[0]!;
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Transactions');
    expect(sheets[0].columns.map((c: { header: string }) => c.header)).toEqual([
      'Date',
      'Amount',
      'Currency',
      'Converted Amount',
      'Category',
      'Merchant',
      'Payment Method',
      'Tags',
      'Description',
      'Transaction Type',
    ]);
  });

  it('test #8 — money/date formatting: amount is numeric, tags joined, category/merchant/payment-method passed through, date stays a real Date', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([
      makeRow({
        amount: '12345.67',
        convertedAmount: '150000.00',
        tags: ['a', 'b'],
        transactionDate: new Date('2026-08-05'),
      }),
    ]);

    await useCase.execute('user-1', range);

    const [sheets] = xlsxGenerator.generate.mock.calls[0]!;
    const [row] = sheets[0].rows;
    expect(row.amount).toBe(12345.67);
    expect(row.convertedAmount).toBe(150000);
    expect(row.tags).toBe('a, b');
    expect(row.category).toBe('FOOD_DINING');
    expect(row.merchant).toBe('Store');
    expect(row.paymentMethod).toBe('cash');
    expect(row.date).toEqual(new Date('2026-08-05'));
    expect(row.transactionType).toBe('EXPENSE');
  });

  it('never invents a category/merchant/payment-method value — null passes through as an empty string, never a fabricated placeholder', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([
      makeRow({ categoryCode: null, merchant: null, paymentMethod: null }),
    ]);

    await useCase.execute('user-1', range);

    const [sheets] = xlsxGenerator.generate.mock.calls[0]!;
    const [row] = sheets[0].rows;
    expect(row.category).toBe('');
    expect(row.merchant).toBe('');
    expect(row.paymentMethod).toBe('');
  });

  it('test #9 — invalid/empty filter object is handled the same as no filter at all', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);

    await useCase.execute('user-1', range, {});

    expect(exportQueryRepository.getTransactionRows).toHaveBeenCalledWith(
      'user-1',
      range,
      {},
      expect.any(Number),
    );
  });

  it('too_large: requesting one more row than the synchronous cap reports kind "too_large" with the real row count, never truncates silently', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => makeRow({ id: `txn-${i}` }));
    exportQueryRepository.getTransactionRows.mockResolvedValue(rows);

    const outcome = await useCase.execute('user-1', range);

    expect(outcome).toEqual({ kind: 'too_large', rowCount: 5001 });
    expect(xlsxGenerator.generate).not.toHaveBeenCalled();
  });

  it('requests exactly cap+1 rows from the repository so it can distinguish "fits" from "exceeds" without a separate COUNT query', async () => {
    exportQueryRepository.getTransactionRows.mockResolvedValue([makeRow()]);

    await useCase.execute('user-1', range);

    const [, , , limit] = exportQueryRepository.getTransactionRows.mock.calls[0]!;
    expect(limit).toBe(5_001);
  });

  it('test #10 — internal error mapping: a repository failure propagates rather than being silently swallowed (the Telegram layer maps it to a safe reply)', async () => {
    exportQueryRepository.getTransactionRows.mockRejectedValue(
      new Error('P2028 db internal detail'),
    );

    await expect(useCase.execute('user-1', range)).rejects.toThrow('P2028 db internal detail');
  });
});

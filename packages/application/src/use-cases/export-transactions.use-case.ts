import type { Buffer } from 'node:buffer';

import { Inject, Injectable } from '@nestjs/common';
import {
  EXPORT_QUERY_REPOSITORY,
  XLSX_GENERATOR,
  type ExportQueryFilters,
  type ExportQueryRepository,
  type ExportTransactionRow,
  type ReportDateRange,
  type XlsxGenerator,
} from '@afa/domain';

/**
 * TASK-FIN-014 (Chapter 10 §10.2, FR-EXP2-001). Deliberately synchronous-
 * only (this task's own scope decision, see its final report) — FR-EXP2-003's
 * own stated synchronous-generation threshold (5,000 rows) becomes the hard
 * cap here: above it, `'too_large'` is returned rather than silently
 * truncating the export or blocking the chat for an unbounded query
 * (FR-EXP2-003's own async/job-queue path for larger exports is explicitly
 * out of this task's scope, a disclosed gap, not implemented here).
 */
const MAX_SYNCHRONOUS_EXPORT_ROWS = 5_000;

export type ExportTransactionsOutcome =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too_large'; readonly rowCount: number }
  | { readonly kind: 'generated'; readonly buffer: Buffer; readonly rowCount: number };

/** FR-EXP2-002's exact column list (date, amount, currency, category, merchant, payment method, tags, description, transaction type), plus the converted-default-currency column TASK-FIN-014's own Definition of Done requires, placed next to the original amount/currency pair per Chapter 19 §19.1's worked example. English-only headers — a documented simplification matching this codebase's own existing precedent for the same class of gap (see `command-registry.ts`'s own FR-BOT-009 doc comment). */
const EXPORT_COLUMNS = [
  { header: 'Date', key: 'date', format: 'date' as const },
  { header: 'Amount', key: 'amount', format: 'decimal2' as const },
  { header: 'Currency', key: 'currency', format: 'text' as const },
  { header: 'Converted Amount', key: 'convertedAmount', format: 'decimal2' as const },
  { header: 'Category', key: 'category', format: 'text' as const },
  { header: 'Merchant', key: 'merchant', format: 'text' as const },
  { header: 'Payment Method', key: 'paymentMethod', format: 'text' as const },
  { header: 'Tags', key: 'tags', format: 'text' as const },
  { header: 'Description', key: 'description', format: 'text' as const },
  { header: 'Transaction Type', key: 'transactionType', format: 'text' as const },
];

function toExportSheetRow(
  row: ExportTransactionRow,
): Record<string, string | number | Date | null> {
  return {
    date: row.transactionDate,
    amount: Number(row.amount),
    currency: row.currency,
    convertedAmount: row.convertedAmount === null ? null : Number(row.convertedAmount),
    category: row.categoryCode ?? '',
    merchant: row.merchant ?? '',
    paymentMethod: row.paymentMethod ?? '',
    tags: row.tags.join(', '),
    description: row.description,
    transactionType: row.transactionType,
  };
}

@Injectable()
export class ExportTransactionsUseCase {
  constructor(
    @Inject(EXPORT_QUERY_REPOSITORY) private readonly exportQueryRepository: ExportQueryRepository,
    @Inject(XLSX_GENERATOR) private readonly xlsxGenerator: XlsxGenerator,
  ) {}

  async execute(
    userId: string,
    range: ReportDateRange,
    filters: ExportQueryFilters = {},
  ): Promise<ExportTransactionsOutcome> {
    const rows = await this.exportQueryRepository.getTransactionRows(
      userId,
      range,
      filters,
      MAX_SYNCHRONOUS_EXPORT_ROWS + 1,
    );

    if (rows.length === 0) {
      return { kind: 'empty' };
    }
    if (rows.length > MAX_SYNCHRONOUS_EXPORT_ROWS) {
      return { kind: 'too_large', rowCount: rows.length };
    }

    const buffer = await this.xlsxGenerator.generate([
      {
        name: 'Transactions',
        columns: EXPORT_COLUMNS,
        rows: rows.map(toExportSheetRow),
      },
    ]);

    return { kind: 'generated', buffer, rowCount: rows.length };
  }
}

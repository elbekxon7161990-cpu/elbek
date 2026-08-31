import type { Buffer } from 'node:buffer';

export const XLSX_GENERATOR = Symbol('XLSX_GENERATOR');

/** `'decimal2'` is FR-EXP2-009's own requirement — native Excel number formatting for amount-shaped columns, never a text-formatted number. `'date'` renders a real Excel date cell (`yyyy-mm-dd`), not a text string, the same "usable without further cleanup" bar §10.2.2/FR-EXP2-009 sets for amounts, extended here to dates since the PRD never says otherwise. `'text'` (the default) is any plain string column (currency code, category, merchant, tags, description, transaction type). */
export type XlsxColumnFormat = 'text' | 'decimal2' | 'date';

export interface XlsxColumnSpec {
  readonly header: string;
  readonly key: string;
  readonly format: XlsxColumnFormat;
}

export interface XlsxSheetSpec {
  readonly name: string;
  readonly columns: readonly XlsxColumnSpec[];
  readonly rows: readonly Readonly<Record<string, string | number | Date | null>>[];
}

/**
 * Vendor-neutral abstraction (TASK-FIN-014's own explicit instruction) —
 * @afa/application depends only on this interface, never on a vendor xlsx
 * SDK directly, same "port lives in @afa/domain, real adapter lives in
 * @afa/infrastructure" split every other external-capability port in this
 * codebase already uses (`OcrProvider`, `LlmProvider`, `SttProvider`,
 * `FxRateProvider`).
 */
export interface XlsxGenerator {
  generate(sheets: readonly XlsxSheetSpec[]): Promise<Buffer>;
}

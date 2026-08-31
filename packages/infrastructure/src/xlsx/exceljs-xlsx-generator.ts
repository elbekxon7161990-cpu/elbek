import { Buffer } from 'node:buffer';

import { Injectable } from '@nestjs/common';
import type { XlsxColumnFormat, XlsxGenerator, XlsxSheetSpec } from '@afa/domain';
import ExcelJS from 'exceljs';

/**
 * TASK-FIN-014 — the one real binding of `@afa/domain`'s vendor-neutral
 * `XlsxGenerator` port, using `exceljs` (chosen for its native per-column
 * `numFmt` support, the mechanism FR-EXP2-009 needs — SheetJS/`xlsx`'s
 * community edition has no equivalent write-side formatting API). No
 * other file in this package imports `exceljs` directly.
 */
const NUMBER_FORMATS: Record<XlsxColumnFormat, string | undefined> = {
  text: undefined,
  decimal2: '0.00',
  date: 'yyyy-mm-dd',
};

@Injectable()
export class ExceljsXlsxGenerator implements XlsxGenerator {
  async generate(sheets: readonly XlsxSheetSpec[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.columns = sheet.columns.map((column) => ({
        header: column.header,
        key: column.key,
        numFmt: NUMBER_FORMATS[column.format],
      }));
      worksheet.addRows(sheet.rows as Record<string, unknown>[]);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}

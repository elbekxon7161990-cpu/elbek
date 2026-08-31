import { Global, Module } from '@nestjs/common';
import { XLSX_GENERATOR } from '@afa/domain';

import { ExceljsXlsxGenerator } from './exceljs-xlsx-generator';

/** Binds @afa/domain's XLSX_GENERATOR port to the real exceljs implementation. */
@Global()
@Module({
  providers: [{ provide: XLSX_GENERATOR, useClass: ExceljsXlsxGenerator }],
  exports: [XLSX_GENERATOR],
})
export class XlsxGeneratorModule {}

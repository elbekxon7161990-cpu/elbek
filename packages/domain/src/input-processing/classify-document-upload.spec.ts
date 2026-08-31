import { describe, expect, it } from 'vitest';

import { classifyDocumentUpload } from './classify-document-upload';

describe('classifyDocumentUpload (Chapter 19 §19.2.2)', () => {
  it('classifies a .pdf file by extension', () => {
    expect(classifyDocumentUpload('statement.pdf', 'application/octet-stream')).toBe('pdf');
  });

  it('classifies by application/pdf MIME type even without a .pdf extension', () => {
    expect(classifyDocumentUpload('statement', 'application/pdf')).toBe('pdf');
  });

  it('classifies a .xlsx file as excel_csv', () => {
    expect(classifyDocumentUpload('export.xlsx', 'application/octet-stream')).toBe('excel_csv');
  });

  it('classifies a .xls file as excel_csv', () => {
    expect(classifyDocumentUpload('export.xls', 'application/octet-stream')).toBe('excel_csv');
  });

  it('classifies a .csv file as excel_csv', () => {
    expect(classifyDocumentUpload('export.csv', 'text/csv')).toBe('excel_csv');
  });

  it('classifies by spreadsheet MIME type even without a recognized extension', () => {
    expect(
      classifyDocumentUpload(
        'export',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('excel_csv');
  });

  it('classifies an unrecognized file type as unsupported (FR-INP-001 — never silently dropped, but never invented support either)', () => {
    expect(classifyDocumentUpload('archive.zip', 'application/zip')).toBe('unsupported');
  });

  it('classifies a file with no extension and an unrecognized MIME type as unsupported', () => {
    expect(classifyDocumentUpload('noextension', 'application/octet-stream')).toBe('unsupported');
  });

  it('is case-insensitive on extension', () => {
    expect(classifyDocumentUpload('STATEMENT.PDF', 'application/octet-stream')).toBe('pdf');
  });
});

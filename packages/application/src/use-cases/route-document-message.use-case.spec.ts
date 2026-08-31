import { describe, expect, it } from 'vitest';

import { RouteDocumentMessageUseCase } from './route-document-message.use-case';

describe('RouteDocumentMessageUseCase', () => {
  it('reports not_yet_supported for a .pdf upload (TASK-AI-007 not built)', () => {
    const outcome = new RouteDocumentMessageUseCase().execute({
      fileName: 'statement.pdf',
      mimeType: 'application/pdf',
    });

    expect(outcome).toEqual({ kind: 'not_yet_supported', classification: 'pdf' });
  });

  it('reports not_yet_supported for a .csv upload (TASK-AI-008 not built)', () => {
    const outcome = new RouteDocumentMessageUseCase().execute({
      fileName: 'export.csv',
      mimeType: 'text/csv',
    });

    expect(outcome).toEqual({ kind: 'not_yet_supported', classification: 'excel_csv' });
  });

  it('reports unsupported for a genuinely unrecognized document type', () => {
    const outcome = new RouteDocumentMessageUseCase().execute({
      fileName: 'archive.zip',
      mimeType: 'application/zip',
    });

    expect(outcome).toEqual({ kind: 'unsupported' });
  });
});

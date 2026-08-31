/**
 * TASK-BOT-001 (Chapter 19 §19.2.2 Modality Routing Matrix) — the three
 * document-upload rows: `.pdf` -> PDF Worker (TASK-AI-007, not yet built),
 * `.xlsx`/`.xls`/`.csv` -> Excel/CSV Worker (TASK-AI-008, not yet built),
 * anything else -> "Rejected with a clear message... never silently
 * dropped" (Chapter 6 §6.7 FR-INP-001). This function only classifies —
 * TASK-AI-007/008 not existing yet means the two recognized-but-unbuilt
 * categories are reported as "not yet supported" by the caller, same
 * never-silent principle, distinct from a genuinely unrecognized file type.
 */
export type DocumentUploadClassification = 'pdf' | 'excel_csv' | 'unsupported';

const PDF_EXTENSIONS = ['.pdf'];
const EXCEL_CSV_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? '' : fileName.slice(lastDot).toLowerCase();
}

export function classifyDocumentUpload(
  fileName: string,
  mimeType: string,
): DocumentUploadClassification {
  const extension = extensionOf(fileName);

  if (PDF_EXTENSIONS.includes(extension) || mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (
    EXCEL_CSV_EXTENSIONS.includes(extension) ||
    mimeType === 'text/csv' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'excel_csv';
  }
  return 'unsupported';
}

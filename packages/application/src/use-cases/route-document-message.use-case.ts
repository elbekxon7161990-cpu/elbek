import { Injectable } from '@nestjs/common';
import type { DocumentUploadClassification } from '@afa/domain';
import { classifyDocumentUpload } from '@afa/domain';

export interface RouteDocumentMessageInput {
  fileName: string;
  mimeType: string;
}

/** `.pdf` — recognized per the Modality Routing Matrix, but TASK-AI-007 (PDF Bank Statement Import Worker) doesn't exist yet. */
export interface NotYetSupportedOutcome {
  kind: 'not_yet_supported';
  classification: Extract<DocumentUploadClassification, 'pdf' | 'excel_csv'>;
}

/** Chapter 6 §6.7 FR-INP-001 — "never silently dropped," a genuinely unrecognized document type. */
export interface UnsupportedOutcome {
  kind: 'unsupported';
}

export type RouteDocumentMessageOutcome = NotYetSupportedOutcome | UnsupportedOutcome;

/**
 * TASK-BOT-001 (Chapter 19 §19.2.2's three document-upload rows). Only
 * classifies and reports — TASK-AI-007 (PDF) and TASK-AI-008 (Excel/CSV)
 * are separate, not-yet-built tasks that own the actual parsing workers and
 * their own queues; this task deliberately does not invent a queue for a
 * worker that doesn't exist, unlike voice/photo where TASK-AI-005/006's
 * queues already exist to enqueue onto.
 */
@Injectable()
export class RouteDocumentMessageUseCase {
  execute(input: RouteDocumentMessageInput): RouteDocumentMessageOutcome {
    const classification = classifyDocumentUpload(input.fileName, input.mimeType);
    if (classification === 'unsupported') {
      return { kind: 'unsupported' };
    }
    return { kind: 'not_yet_supported', classification };
  }
}

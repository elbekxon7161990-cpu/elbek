import type { OcrExtractionJobPayload } from '../ocr/ocr-extraction-job';

export const OCR_EXTRACTION_QUEUE = Symbol('OCR_EXTRACTION_QUEUE');

/**
 * TASK-BOT-001 — the producer-side counterpart to TASK-AI-006's
 * `ocr-extraction` BullMQ queue, mirroring `VoiceTranscriptionQueuePort`
 * exactly for the same reason (`@afa/application` may never import
 * `bullmq` directly).
 */
export interface OcrExtractionQueuePort {
  enqueue(payload: OcrExtractionJobPayload): Promise<void>;
}

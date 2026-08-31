import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * TASK-AI-006 (Chapter 3 §3.3.3 Job Queue & Worker Pool; ADR-INP-005 —
 * "Worker capacity scales independently per modality"). OCR's own
 * dedicated queue, not shared with `stt-transcription` or any other
 * modality, mirroring `SttTranscriptionQueueModule` (TASK-AI-005) exactly.
 *
 * Registers only the queue itself — the `@Processor` that consumes it
 * lives in `apps/worker` (a composition-root concern depending on
 * `@afa/application`; this package must never depend on
 * `@afa/application` — IMPLEMENTATION-BLUEPRINT.md §2).
 */
export const OCR_EXTRACTION_QUEUE_NAME = 'ocr-extraction';

@Module({
  imports: [
    BullModule.registerQueue({
      name: OCR_EXTRACTION_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  exports: [BullModule],
})
export class OcrExtractionQueueModule {}

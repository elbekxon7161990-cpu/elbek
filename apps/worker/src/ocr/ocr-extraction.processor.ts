import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ProcessReceiptImageUseCase } from '@afa/application';
import type { OcrExtractionJobPayload } from '@afa/domain';
import { OCR_EXTRACTION_QUEUE_NAME } from '@afa/infrastructure';
import { runWithUserContext } from '@afa/shared';

/**
 * TASK-AI-006 — the thin BullMQ wiring for §6.13.2's "Job dequeued" step,
 * mirroring `SttTranscriptionProcessor` (TASK-AI-005) exactly. All real
 * logic lives in `ProcessReceiptImageUseCase` (`@afa/application`),
 * already fully unit-tested with fakes; this class only dequeues,
 * dispatches, and reports.
 *
 * Never logs `job.data` wholesale (would include the Object Storage URI
 * and Telegram file ID) — only the outcome status.
 *
 * The same basic `userId` authorization sanity check as the STT processor
 * — actual authentication happens upstream, at enqueue time, in the Bot
 * Application Layer (a different, not-yet-built task).
 *
 * URGENT follow-up (real-boot fix) — wraps execution in `runWithUserContext`,
 * the same single-wrap-point-per-request pattern `TelegramBotService`'s own
 * Telegraf middleware already uses (`await runWithUserContext(user.id, next)`).
 * `ProcessReceiptImageUseCase` writes a `TransactionDraft` row (RLS-protected,
 * this task's own completion-round addition), and this processor is the
 * pipeline's own request boundary — without this, every real OCR job fails
 * with `MissingDatabaseUserContextError`, caught by the first genuinely real,
 * full cross-process E2E run.
 */
@Processor(OCR_EXTRACTION_QUEUE_NAME)
@Injectable()
export class OcrExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrExtractionProcessor.name);

  constructor(private readonly processReceiptImage: ProcessReceiptImageUseCase) {
    super();
  }

  async process(job: Job<OcrExtractionJobPayload>): Promise<{ status: string }> {
    if (!job.data.userId) {
      throw new Error(
        'OCR job payload is missing userId — refusing to process an unauthenticated job.',
      );
    }

    const outcome = await runWithUserContext(job.data.userId, () =>
      this.processReceiptImage.execute(job.data),
    );

    this.logger.log(`OCR job ${job.id} completed with status="${outcome.status}"`);

    return { status: outcome.status };
  }
}

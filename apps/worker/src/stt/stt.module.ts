import { Module } from '@nestjs/common';
import { AiExtractionModule } from '@afa/application';
import {
  DraftRepositoryModule,
  NotificationDeliveryQueueRepositoryModule,
  NotificationRepositoryModule,
  SttTranscriptionQueueModule,
} from '@afa/infrastructure';

import { SttTranscriptionProcessor } from './stt-transcription.processor';

/**
 * TASK-AI-005 — wires the STT queue (infrastructure) to the extraction/
 * transcription use cases (application) via the processor.
 *
 * Registered in `AppModule` (`apps/worker/src/app.module.ts`) alongside
 * `SttProviderModule`, which binds the real `STT_PROVIDER` (Google Gemini)
 * — the same deferral this module was previously under (per its own
 * now-superseded comment) is resolved: `TranscribeVoiceMessageUseCase`
 * (inside `AiExtractionModule`) now has every token it needs
 * (`STT_PROVIDER`/`OBJECT_STORAGE`/`LLM_PROVIDER`/`EXTRACTION_MODEL_CONFIG`)
 * bound to a real implementation, mirroring `OcrModule`'s own composition
 * exactly.
 *
 * Completion round: `DraftRepositoryModule`/`NotificationRepositoryModule`/
 * `NotificationDeliveryQueueRepositoryModule` are imported HERE, mirroring
 * `OcrModule`'s own identical addition exactly — `TranscribeVoiceMessageUseCase`
 * now creates a `TransactionDraftRecord` and an async Telegram review
 * notification on a successful transcription, closing the same
 * worker->Conversation-Engine hand-off gap `ProcessReceiptImageUseCase`
 * already closed for OCR. All three are `@Global()`, so importing them here
 * makes their tokens visible everywhere in this app's graph, same mechanism
 * as `OcrModule`.
 */
@Module({
  imports: [
    AiExtractionModule,
    SttTranscriptionQueueModule,
    DraftRepositoryModule,
    NotificationRepositoryModule,
    NotificationDeliveryQueueRepositoryModule,
  ],
  providers: [SttTranscriptionProcessor],
})
export class SttModule {}

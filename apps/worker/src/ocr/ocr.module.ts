import { Module } from '@nestjs/common';
import { AiExtractionModule } from '@afa/application';
import {
  DraftRepositoryModule,
  NotificationDeliveryQueueRepositoryModule,
  NotificationRepositoryModule,
  OcrExtractionQueueModule,
} from '@afa/infrastructure';

import { OcrExtractionProcessor } from './ocr-extraction.processor';

/**
 * TASK-AI-006 — wires the OCR queue (infrastructure) to the extraction use
 * case (application) via the processor, mirroring `SttModule`
 * (TASK-AI-005) exactly.
 *
 * Completion round: now imported into `AppModule`
 * (`apps/worker/src/app.module.ts`), which also newly imports
 * `LlmProviderModule`/`ExtractionModelConfigModule`/`OcrProviderModule` —
 * together these satisfy every token `ProcessReceiptImageUseCase` needs
 * (`OCR_PROVIDER`, `LLM_PROVIDER`, `EXTRACTION_MODEL_CONFIG`,
 * `OBJECT_STORAGE` — the last already global via `AccountPurgeModule`'s own
 * `ObjectStorageBindingModule`). `DraftRepositoryModule`/
 * `NotificationRepositoryModule`/`NotificationDeliveryQueueRepositoryModule`
 * are imported HERE (not in `AppModule` directly) so this feature's own
 * composition stays self-contained in one place, mirroring
 * `AccountPurgeModule`'s own `ObjectStorageBindingModule` import precedent
 * exactly — all three are `@Global()`, so importing them here makes their
 * tokens visible everywhere in this app's graph, same mechanism.
 */
@Module({
  imports: [
    AiExtractionModule,
    OcrExtractionQueueModule,
    DraftRepositoryModule,
    NotificationRepositoryModule,
    NotificationDeliveryQueueRepositoryModule,
  ],
  providers: [OcrExtractionProcessor],
})
export class OcrModule {}

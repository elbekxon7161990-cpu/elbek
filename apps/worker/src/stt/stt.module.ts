import { Module } from '@nestjs/common';
import { AiExtractionModule } from '@afa/application';
import { SttTranscriptionQueueModule } from '@afa/infrastructure';

import { SttTranscriptionProcessor } from './stt-transcription.processor';

/**
 * TASK-AI-005 — wires the STT queue (infrastructure) to the extraction/
 * transcription use cases (application) via the processor.
 *
 * NOT YET imported into `AppModule` (`apps/worker/src/app.module.ts`).
 * `TranscribeVoiceMessageUseCase` (inside `AiExtractionModule`) requires
 * `STT_PROVIDER`/`OBJECT_STORAGE`/`LLM_PROVIDER`/`EXTRACTION_MODEL_CONFIG`
 * to be bound — none have a real implementation yet (TASK-INFRA-010's own
 * report; no vendor SDK is introduced by this task, see the final report's
 * REAL_PROVIDER_STATUS). Importing this module into a booting `AppModule`
 * before those bindings exist would fail NestJS DI resolution at startup.
 * This mirrors the exact same deferral already established for
 * `AiExtractionModule` itself and `FinanceModule` — built, fully unit-
 * tested in isolation (bypassing Nest's DI container, direct
 * construction), and wired into the real bootstrap only once the
 * composition root has a real provider to bind.
 */
@Module({
  imports: [AiExtractionModule, SttTranscriptionQueueModule],
  providers: [SttTranscriptionProcessor],
})
export class SttModule {}

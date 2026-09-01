import { Module } from '@nestjs/common';
import { AiExtractionModule } from '@afa/application';
import { SttTranscriptionQueueModule } from '@afa/infrastructure';

import { SttTranscriptionProcessor } from './stt-transcription.processor';

/**
 * TASK-AI-005 — wires the STT queue (infrastructure) to the extraction/
 * transcription use cases (application) via the processor.
 *
 * Registered in `AppModule` (`apps/worker/src/app.module.ts`) alongside
 * `SttProviderModule`, which binds the real `STT_PROVIDER` (OpenAI
 * Whisper) — the same deferral this module was previously under (per its
 * own now-superseded comment) is resolved: `TranscribeVoiceMessageUseCase`
 * (inside `AiExtractionModule`) now has every token it needs
 * (`STT_PROVIDER`/`OBJECT_STORAGE`/`LLM_PROVIDER`/`EXTRACTION_MODEL_CONFIG`)
 * bound to a real implementation, mirroring `OcrModule`'s own composition
 * exactly.
 */
@Module({
  imports: [AiExtractionModule, SttTranscriptionQueueModule],
  providers: [SttTranscriptionProcessor],
})
export class SttModule {}

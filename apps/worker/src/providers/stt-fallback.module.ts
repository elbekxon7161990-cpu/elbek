import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { STT_PROVIDER } from '@afa/domain';
import { FakeSttProvider } from '@afa/infrastructure';

/**
 * TASK-AI-006 (OCR completion round) — binds `STT_PROVIDER` to the same
 * always-fails-confidence-gating `FakeSttProvider` default that
 * `apps/telegram-bot`'s `EnvironmentBlockedProvidersModule` already uses
 * (TASK-MVP-002 precedent), for the same reason: no real STT vendor adapter
 * exists yet, and that decision is explicitly out of this task's scope.
 *
 * Needed only because `OcrModule` imports `@afa/application`'s
 * `AiExtractionModule`, which bundles ALL five AI use-cases together
 * (`ValidateStructuredAiOutputUseCase`, `ExtractTransactionCandidatesUseCase`,
 * `RunCalibrationEvaluationUseCase`, `TranscribeVoiceMessageUseCase`,
 * `ProcessReceiptImageUseCase`) — Nest eagerly instantiates every provider a
 * module exports, so `TranscribeVoiceMessageUseCase` (needing `STT_PROVIDER`)
 * must resolve here even though `apps/worker` never calls it (no processor in
 * this app ever transcribes voice). This app's real `OCR_PROVIDER` binding
 * (`OcrProviderModule`, real Claude Vision) is unaffected — this module binds
 * `STT_PROVIDER` only.
 *
 * Must be REPLACED (a real STT adapter bound instead), never extended, once
 * one exists — same rule as its telegram-bot sibling.
 */
const NOT_IMPLEMENTED_STT_RESULT = {
  transcript: '',
  detectedLanguage: null,
  confidence: 0,
  durationSeconds: 0,
  providerModelIdentifier: 'fake-stt-not-implemented',
};

@Global()
@Module({
  providers: [
    { provide: STT_PROVIDER, useFactory: () => new FakeSttProvider(NOT_IMPLEMENTED_STT_RESULT) },
  ],
  exports: [STT_PROVIDER],
})
export class SttFallbackModule implements OnModuleInit {
  private readonly logger = new Logger(SttFallbackModule.name);

  onModuleInit(): void {
    this.logger.warn(
      'SttFallbackModule is active: STT_PROVIDER is a FAKE implementation, unused by apps/worker (bound only because AiExtractionModule requires it to resolve). No real voice transcription happens here.',
    );
  }
}

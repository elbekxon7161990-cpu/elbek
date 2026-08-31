import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { OCR_PROVIDER, STT_PROVIDER } from '@afa/domain';
import { FakeOcrProvider, FakeSttProvider } from '@afa/infrastructure';

/**
 * A voice/photo message that reaches these fakes gets an honest
 * "could not be processed" result (empty transcript/text, zero
 * confidence) rather than a fabricated transcript or receipt —
 * `evaluate-transcript-confidence`/`evaluate-image-validity` (TASK-AI-005/
 * 006) already reject zero-confidence input, so this degrades to the
 * existing "voice/photo not understood" reply path, not a silent
 * fabrication (AI-P6, fail closed).
 */
const NOT_IMPLEMENTED_STT_RESULT = {
  transcript: '',
  detectedLanguage: null,
  confidence: 0,
  durationSeconds: 0,
  providerModelIdentifier: 'fake-stt-not-implemented',
};

const NOT_IMPLEMENTED_OCR_RESULT = {
  rawText: '',
  contentClassification: 'unknown' as const,
  detectedLanguage: null,
  confidence: 0,
  providerModelIdentifier: 'fake-ocr-not-implemented',
  processingDurationMs: 0,
};

/**
 * TEMPORARY composition-root binding. `STT_PROVIDER`/`OCR_PROVIDER` are
 * bound to deterministic fakes because no real vendor adapter exists yet
 * for either (TASK-AI-005/006's own gap, still open — OCR vendor selection
 * is explicitly out of scope for the Object Storage groundwork task) — this
 * app is TEXT-ONLY today; the voice/photo routes remain structurally
 * present (`RouteVoiceMessageUseCase`/`RoutePhotoMessageUseCase` are always
 * part of the DI graph) but cannot do real transcription/OCR work yet.
 *
 * `OBJECT_STORAGE` is deliberately NOT bound here anymore (TASK-AI-006
 * Object Storage groundwork) — it moved to its own real-or-explicit-fake
 * composition root, `ObjectStorageModule` (`@afa/infrastructure`), imported
 * separately by `telegram-bot.module.ts`. Binding it here alongside two
 * still-fake tokens would make it easy to mistake the real adapter for
 * "also still fake."
 *
 * TASK-MVP-002 — `STT_PROVIDER`/`OCR_PROVIDER` were previously not bound
 * *at all* anywhere in this app, so the app could not boot outside of a
 * test that mocks these tokens away. `FakeSttProvider`/`FakeOcrProvider`'s
 * own doc comments say "never wired into any production DI module" —
 * written before anyone had actually tried to boot the real, full
 * `AppModule`; that assumption is corrected here rather than left to
 * silently block every real deployment of the text-only MVP. Both are
 * wired with a fixed, always-fails-confidence-gating default (never a
 * fabricated transcript), and this module logs loudly on startup.
 *
 * This module must be REPLACED (real adapters bound instead), never
 * extended, once real STT/OCR vendor adapters exist.
 *
 * `@Global()` (TASK-MVP-002) — see @afa/infrastructure's
 * user-repository.module.ts for why a sibling import under a shared
 * parent module does not make these tokens visible to whichever module
 * needs them.
 */
@Global()
@Module({
  providers: [
    { provide: STT_PROVIDER, useFactory: () => new FakeSttProvider(NOT_IMPLEMENTED_STT_RESULT) },
    { provide: OCR_PROVIDER, useFactory: () => new FakeOcrProvider(NOT_IMPLEMENTED_OCR_RESULT) },
  ],
  exports: [STT_PROVIDER, OCR_PROVIDER],
})
export class EnvironmentBlockedProvidersModule implements OnModuleInit {
  private readonly logger = new Logger(EnvironmentBlockedProvidersModule.name);

  onModuleInit(): void {
    this.logger.warn(
      'EnvironmentBlockedProvidersModule is active: STT_PROVIDER/OCR_PROVIDER are FAKE implementations. No real voice transcription or receipt OCR is happening yet — OBJECT_STORAGE now uses the real ObjectStorageModule, bound separately.',
    );
  }
}

import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STT_PROVIDER } from '@afa/domain';
import type { SttProvider } from '@afa/domain';
import type { EnvironmentVariables } from '@afa/shared';

import { CircuitBreakerSttProvider } from './circuit-breaker-stt-provider';
import { FakeSttProvider } from './fake-stt-provider';
import { GeminiSttProvider } from './gemini-stt-provider';
import { RetryingSttProvider } from './retrying-stt-provider';

const logger = new Logger('SttProviderModule');

/** Wide margin for a worst-case 3-minute voice note (`DEFAULT_AUDIO_VALIDATION_LIMITS.maxDurationSeconds`). */
const GEMINI_STT_CLIENT_TIMEOUT_MS = 60_000;
const DEFAULT_STT_MODEL = 'gemini-2.5-flash';

const NOT_IMPLEMENTED_STT_RESULT = {
  transcript: '',
  detectedLanguage: null,
  confidence: 0,
  durationSeconds: 0,
  providerModelIdentifier: 'fake-stt-not-implemented',
};

/**
 * Exported for direct unit testing of the selection/fail-fast logic without
 * standing up a full Nest DI container — mirrors `buildOcrProvider`'s own
 * convention exactly.
 */
export function buildSttProvider(config: ConfigService<EnvironmentVariables, true>): SttProvider {
  const apiKey = config.get('GEMINI_API_KEY', { infer: true });

  if (apiKey) {
    const model = config.get('GEMINI_STT_MODEL', { infer: true }) ?? DEFAULT_STT_MODEL;
    const gemini = new GeminiSttProvider(apiKey, model, GEMINI_STT_CLIENT_TIMEOUT_MS);
    const retrying = new RetryingSttProvider(gemini);
    return new CircuitBreakerSttProvider(retrying, 'gemini');
  }

  const allowFake = config.get('ALLOW_FAKE_STT_PROVIDER', { infer: true });
  if (allowFake) {
    logger.warn(
      'GEMINI_API_KEY is not set and ALLOW_FAKE_STT_PROVIDER=true — binding a FAKE SttProvider. This must never be true in a production deployment.',
    );
    return new FakeSttProvider(NOT_IMPLEMENTED_STT_RESULT);
  }

  // Fail loud, at startup — never silently fall back to a fake STT provider
  // (same precedent as buildLlmProvider/buildOcrProvider). A NestJS factory
  // provider that throws fails the whole application's bootstrap.
  throw new Error(
    'STT_PROVIDER is not configured: GEMINI_API_KEY is missing. Set GEMINI_API_KEY to use the real Gemini provider, or explicitly set ALLOW_FAKE_STT_PROVIDER=true for local development only — never in production.',
  );
}

/**
 * The composition root for `STT_PROVIDER` (TASK-AI-005's port), mirroring
 * `LlmProviderModule`/`OcrProviderModule`'s established
 * real-or-explicit-fake-or-fail-fast pattern exactly. Binds the real
 * `GeminiSttProvider` — wrapped in the existing
 * `RetryingSttProvider`/`CircuitBreakerSttProvider` decorators (already
 * built, previously unwired) — when `GEMINI_API_KEY` is configured;
 * otherwise fails startup unless `ALLOW_FAKE_STT_PROVIDER` explicitly opts
 * into a fake for local development.
 *
 * A deliberately SEPARATE credential from `ANTHROPIC_API_KEY` — Claude has
 * no audio-transcription API, so this is a different vendor entirely, not
 * a second key for the same one.
 *
 * `@Global()`, same precedent as `LlmProviderModule`/`OcrProviderModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: STT_PROVIDER,
      useFactory: buildSttProvider,
      inject: [ConfigService],
    },
  ],
  exports: [STT_PROVIDER],
})
export class SttProviderModule {}

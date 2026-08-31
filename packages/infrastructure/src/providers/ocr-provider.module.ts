import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OCR_PROVIDER } from '@afa/domain';
import type { OcrProvider } from '@afa/domain';
import type { EnvironmentVariables } from '@afa/shared';
import Anthropic from '@anthropic-ai/sdk';

import { AnthropicVisionOcrProvider } from './anthropic-vision-ocr-provider';
import { CircuitBreakerOcrProvider } from './circuit-breaker-ocr-provider';
import { FakeOcrProvider } from './fake-ocr-provider';
import { RetryingOcrProvider } from './retrying-ocr-provider';

const logger = new Logger('OcrProviderModule');

/** Claude vision calls (base64 image + a short instruction) are heavier than a typical text completion; matches NFR-OCR-002's p95 < 10s MVP budget with margin. */
const ANTHROPIC_VISION_CLIENT_TIMEOUT_MS = 30_000;
const DEFAULT_OCR_MODEL = 'claude-sonnet-5';

const NOT_IMPLEMENTED_OCR_RESULT = {
  rawText: '',
  contentClassification: 'unknown' as const,
  detectedLanguage: null,
  confidence: 0,
  providerModelIdentifier: 'fake-ocr-not-implemented',
  processingDurationMs: 0,
};

/**
 * Exported for direct unit testing of the selection/fail-fast logic without
 * standing up a full Nest DI container — mirrors `buildLlmProvider`'s own
 * convention exactly.
 *
 * `OCR_ANTHROPIC_MODEL` falls back to `ANTHROPIC_MODEL` (the same model the
 * text-extraction LLM path already uses) when unset — a separate override
 * exists only for the case where a different Claude model tier makes sense
 * for vision specifically, not because a different model is required by
 * default.
 */
export function buildOcrProvider(config: ConfigService<EnvironmentVariables, true>): OcrProvider {
  const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });

  if (apiKey) {
    const model =
      config.get('OCR_ANTHROPIC_MODEL', { infer: true }) ??
      config.get('ANTHROPIC_MODEL', { infer: true }) ??
      DEFAULT_OCR_MODEL;
    // maxRetries: 0 — the SDK's own retry must never run alongside
    // RetryingOcrProvider's, which wraps this adapter below; retrying twice
    // over would silently multiply both latency and cost per failure.
    const client = new Anthropic({
      apiKey,
      maxRetries: 0,
      timeout: ANTHROPIC_VISION_CLIENT_TIMEOUT_MS,
    });
    const anthropicVision = new AnthropicVisionOcrProvider(
      client,
      model,
      ANTHROPIC_VISION_CLIENT_TIMEOUT_MS,
    );
    const retrying = new RetryingOcrProvider(anthropicVision);
    return new CircuitBreakerOcrProvider(retrying, 'anthropic-vision');
  }

  const allowFake = config.get('ALLOW_FAKE_OCR_PROVIDER', { infer: true });
  if (allowFake) {
    logger.warn(
      'ANTHROPIC_API_KEY is not set and ALLOW_FAKE_OCR_PROVIDER=true — binding a FAKE OcrProvider. This must never be true in a production deployment.',
    );
    return new FakeOcrProvider(NOT_IMPLEMENTED_OCR_RESULT);
  }

  // Fail loud, at startup — never silently fall back to a fake OCR provider
  // (same precedent as buildLlmProvider/buildObjectStorage). A NestJS
  // factory provider that throws fails the whole application's bootstrap.
  throw new Error(
    'OCR_PROVIDER is not configured: ANTHROPIC_API_KEY is missing. Set ANTHROPIC_API_KEY to use the real Claude Vision provider, or explicitly set ALLOW_FAKE_OCR_PROVIDER=true for local development only — never in production.',
  );
}

/**
 * TASK-AI-006 — the composition root for `OCR_PROVIDER` (TASK-INFRA-010's
 * port), mirroring `LlmProviderModule`'s established real-or-explicit-fake-
 * or-fail-fast pattern exactly. Binds the real `AnthropicVisionOcrProvider`
 * — wrapped in the existing `RetryingOcrProvider`/`CircuitBreakerOcrProvider`
 * decorators (previously built, previously unwired) — when
 * `ANTHROPIC_API_KEY` is configured; otherwise fails startup unless
 * `ALLOW_FAKE_OCR_PROVIDER` explicitly opts into a fake for local
 * development.
 *
 * Deliberately reuses `ANTHROPIC_API_KEY` (already configured for
 * `LLM_PROVIDER`) rather than requiring a second Anthropic credential — a
 * disclosed default, not an oversight; see this task's own final report.
 *
 * `@Global()`, same precedent as `LlmProviderModule`/`ObjectStorageModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: OCR_PROVIDER,
      useFactory: buildOcrProvider,
      inject: [ConfigService],
    },
  ],
  exports: [OCR_PROVIDER],
})
export class OcrProviderModule {}

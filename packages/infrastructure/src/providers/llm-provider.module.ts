import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_PROVIDER } from '@afa/domain';
import type { LlmProvider } from '@afa/domain';
import type { EnvironmentVariables } from '@afa/shared';
import Anthropic from '@anthropic-ai/sdk';

import { AnthropicLlmProvider } from './anthropic-llm-provider';
import { CircuitBreakerLlmProvider } from './circuit-breaker-llm-provider';
import { FakeLlmProvider } from './fake-llm-provider';
import { RetryingLlmProvider } from './retrying-llm-provider';

const logger = new Logger('LlmProviderModule');

/** The Anthropic SDK client's own request timeout — this app's own latency budget for a single provider call, independent of `RetryingLlmProvider`'s retry count. */
const ANTHROPIC_CLIENT_TIMEOUT_MS = 60_000;

/** Exported for direct unit testing of the selection/fail-fast logic without standing up a full Nest DI container. */
export function buildLlmProvider(config: ConfigService<EnvironmentVariables, true>): LlmProvider {
  const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });

  if (apiKey) {
    // maxRetries: 0 — the SDK's own retry must never run alongside
    // RetryingLlmProvider's (TASK-INFRA-010's resilience decorator), which
    // wraps this adapter below; retrying twice over would silently multiply
    // both latency and cost per failure.
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: ANTHROPIC_CLIENT_TIMEOUT_MS });
    const anthropic = new AnthropicLlmProvider(client, ANTHROPIC_CLIENT_TIMEOUT_MS);
    const retrying = new RetryingLlmProvider(anthropic);
    return new CircuitBreakerLlmProvider(retrying, 'anthropic');
  }

  const allowFake = config.get('ALLOW_FAKE_LLM_PROVIDER', { infer: true });
  if (allowFake) {
    logger.warn(
      'ANTHROPIC_API_KEY is not set and ALLOW_FAKE_LLM_PROVIDER=true — binding a FAKE LlmProvider. This must never be true in a production deployment.',
    );
    return new FakeLlmProvider({
      content: JSON.stringify({
        transactions: [],
        detectedLanguage: 'en',
        clarificationNeeded: false,
        clarificationQuestion: null,
      }),
      finishReason: 'stop',
    });
  }

  // Fail loud, at startup — never silently fall back to a fake AI provider
  // (TASK-INFRA-AI-REAL-001's explicit requirement). A NestJS factory
  // provider that throws fails the whole application's bootstrap.
  throw new Error(
    'LLM_PROVIDER is not configured: ANTHROPIC_API_KEY is missing. Set ANTHROPIC_API_KEY to use the real Anthropic provider, or explicitly set ALLOW_FAKE_LLM_PROVIDER=true for local development only — never in production.',
  );
}

/**
 * TASK-INFRA-AI-REAL-001 — the composition root for `LLM_PROVIDER`
 * (TASK-INFRA-010's port). Binds the real `AnthropicLlmProvider` — wrapped
 * in the existing `RetryingLlmProvider`/`CircuitBreakerLlmProvider`
 * decorators, composed exactly as every other provider category in this
 * codebase already composes them — when `ANTHROPIC_API_KEY` is configured;
 * otherwise fails startup unless `ALLOW_FAKE_LLM_PROVIDER` explicitly opts
 * into a fake for local development.
 *
 * Deliberately does NOT bind `EXTRACTION_MODEL_CONFIG` — that token is
 * `@afa/application`'s own (`ExtractTransactionCandidatesUseCase`), and
 * `@afa/infrastructure` must never depend on `@afa/application`
 * (this package's own description / IMPLEMENTATION-BLUEPRINT.md §2).
 * Whichever app imports this module must separately bind
 * `EXTRACTION_MODEL_CONFIG` itself.
 *
 * `@Global()` (TASK-MVP-002) — see @afa/infrastructure's
 * user-repository.module.ts for why a sibling import under a shared
 * parent module does not make `LLM_PROVIDER` visible to
 * `@afa/application`'s `AiExtractionModule`, which needs it.
 */
@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: buildLlmProvider,
      inject: [ConfigService],
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmProviderModule {}

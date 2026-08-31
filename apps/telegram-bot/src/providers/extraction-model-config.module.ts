import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EXTRACTION_MODEL_CONFIG } from '@afa/application';
import type { ExtractionModelConfig } from '@afa/application';
import type { EnvironmentVariables } from '@afa/shared';

/** Used only when `ANTHROPIC_MODEL` is unset — a documented, overridable default, not a hardcoded, unconfigurable model choice. */
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Exported for direct unit testing without standing up a full Nest DI container. */
export function buildExtractionModelConfig(
  config: ConfigService<EnvironmentVariables, true>,
): ExtractionModelConfig {
  return {
    model: config.get('ANTHROPIC_MODEL', { infer: true }) ?? DEFAULT_MODEL,
    temperature: config.get('ANTHROPIC_TEMPERATURE', { infer: true }),
    maxOutputTokens: config.get('ANTHROPIC_MAX_OUTPUT_TOKENS', { infer: true }),
  };
}

/**
 * TASK-INFRA-AI-REAL-001 — binds `@afa/application`'s `EXTRACTION_MODEL_CONFIG`
 * token from this app's own Anthropic env vars. Lives here, not in
 * `@afa/infrastructure`'s `LlmProviderModule`, because `EXTRACTION_MODEL_CONFIG`
 * is an `@afa/application` token and `@afa/infrastructure` must never depend
 * on `@afa/application` (that package's own description).
 *
 * `@Global()` (TASK-MVP-002) — see @afa/infrastructure's
 * user-repository.module.ts for why a sibling import under a shared
 * parent module does not make `EXTRACTION_MODEL_CONFIG` visible to
 * `@afa/application`'s `AiExtractionModule`, which needs it.
 */
@Global()
@Module({
  providers: [
    {
      provide: EXTRACTION_MODEL_CONFIG,
      useFactory: buildExtractionModelConfig,
      inject: [ConfigService],
    },
  ],
  exports: [EXTRACTION_MODEL_CONFIG],
})
export class ExtractionModelConfigModule {}

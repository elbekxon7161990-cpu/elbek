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
 * TASK-AI-006 (OCR completion round) — a deliberate, minimal duplication of
 * `apps/telegram-bot/src/providers/extraction-model-config.module.ts`
 * (byte-for-byte identical logic), NOT a shared package export. This
 * module lives in each APP's own composition root by established
 * convention (that file's own doc comment: `EXTRACTION_MODEL_CONFIG` is an
 * `@afa/application` token, and `@afa/infrastructure` must never depend on
 * `@afa/application`) — moving it to a shared location would mean editing
 * `apps/telegram-bot`'s existing, closed file's import graph, which this
 * task's own instructions say not to do. `apps/worker` needs this binding
 * for the exact same reason `apps/telegram-bot` does: `OcrModule` ->
 * `AiExtractionModule` -> `ExtractTransactionCandidatesUseCase` needs
 * `EXTRACTION_MODEL_CONFIG` resolvable, and this app never bound it before
 * `OcrModule` was wired in (this app was never LLM-extraction-capable
 * until this task).
 *
 * `@Global()`, same precedent as the telegram-bot original.
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

import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { buildExtractionModelConfig } from './extraction-model-config.module';

function makeConfig(
  values: Partial<EnvironmentVariables>,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: vi.fn((key: string) => (values as Record<string, unknown>)[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('buildExtractionModelConfig', () => {
  it('uses ANTHROPIC_MODEL when set', () => {
    const result = buildExtractionModelConfig(makeConfig({ ANTHROPIC_MODEL: 'claude-opus-5' }));

    expect(result.model).toBe('claude-opus-5');
  });

  it('falls back to a documented default model when ANTHROPIC_MODEL is unset', () => {
    const result = buildExtractionModelConfig(makeConfig({}));

    expect(result.model).toBe('claude-sonnet-5');
  });

  it('forwards ANTHROPIC_TEMPERATURE when set', () => {
    const result = buildExtractionModelConfig(makeConfig({ ANTHROPIC_TEMPERATURE: 0.3 }));

    expect(result.temperature).toBe(0.3);
  });

  it('leaves temperature undefined when unset (provider-default temperature)', () => {
    const result = buildExtractionModelConfig(makeConfig({}));

    expect(result.temperature).toBeUndefined();
  });

  it('forwards ANTHROPIC_MAX_OUTPUT_TOKENS when set', () => {
    const result = buildExtractionModelConfig(makeConfig({ ANTHROPIC_MAX_OUTPUT_TOKENS: 2048 }));

    expect(result.maxOutputTokens).toBe(2048);
  });

  it('leaves maxOutputTokens undefined when unset (adapter-level default applies)', () => {
    const result = buildExtractionModelConfig(makeConfig({}));

    expect(result.maxOutputTokens).toBeUndefined();
  });
});

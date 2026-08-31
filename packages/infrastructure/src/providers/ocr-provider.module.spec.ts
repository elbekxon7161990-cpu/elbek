import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { AnthropicVisionOcrProvider } from './anthropic-vision-ocr-provider';
import { CircuitBreakerOcrProvider } from './circuit-breaker-ocr-provider';
import { FakeOcrProvider } from './fake-ocr-provider';
import { RetryingOcrProvider } from './retrying-ocr-provider';
import { buildOcrProvider } from './ocr-provider.module';

function makeConfig(
  values: Partial<EnvironmentVariables>,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: vi.fn((key: string) => (values as Record<string, unknown>)[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('buildOcrProvider (OcrProviderModule composition)', () => {
  it('binds the real Anthropic vision provider chain (Retrying + CircuitBreaker over AnthropicVisionOcrProvider) when ANTHROPIC_API_KEY is set', () => {
    const provider = buildOcrProvider(makeConfig({ ANTHROPIC_API_KEY: 'sk-ant-test-key' }));

    expect(provider).toBeInstanceOf(CircuitBreakerOcrProvider);
    const retrying = (provider as unknown as { delegate: unknown }).delegate;
    expect(retrying).toBeInstanceOf(RetryingOcrProvider);
    const anthropicVision = (retrying as unknown as { delegate: unknown }).delegate;
    expect(anthropicVision).toBeInstanceOf(AnthropicVisionOcrProvider);
  });

  it('never binds a FakeOcrProvider when a real API key is present, even if ALLOW_FAKE_OCR_PROVIDER is also true', () => {
    const provider = buildOcrProvider(
      makeConfig({ ANTHROPIC_API_KEY: 'sk-ant-test-key', ALLOW_FAKE_OCR_PROVIDER: true }),
    );

    expect(provider).not.toBeInstanceOf(FakeOcrProvider);
    expect(provider).toBeInstanceOf(CircuitBreakerOcrProvider);
  });

  it('binds a FakeOcrProvider when the API key is missing AND ALLOW_FAKE_OCR_PROVIDER is explicitly true', () => {
    const provider = buildOcrProvider(makeConfig({ ALLOW_FAKE_OCR_PROVIDER: true }));

    expect(provider).toBeInstanceOf(FakeOcrProvider);
  });

  it('fails loudly (throws) when the API key is missing and ALLOW_FAKE_OCR_PROVIDER is not set — never silently runs a fake in production', () => {
    expect(() => buildOcrProvider(makeConfig({}))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('fails loudly when the API key is missing and ALLOW_FAKE_OCR_PROVIDER is explicitly false', () => {
    expect(() =>
      buildOcrProvider(makeConfig({ ALLOW_FAKE_OCR_PROVIDER: false })),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('the startup error never includes any credential value', () => {
    let message = '';
    try {
      buildOcrProvider(makeConfig({}));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('sk-ant');
  });
});

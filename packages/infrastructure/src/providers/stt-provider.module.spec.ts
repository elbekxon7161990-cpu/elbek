import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { CircuitBreakerSttProvider } from './circuit-breaker-stt-provider';
import { FakeSttProvider } from './fake-stt-provider';
import { OpenAiWhisperSttProvider } from './openai-whisper-stt-provider';
import { RetryingSttProvider } from './retrying-stt-provider';
import { buildSttProvider } from './stt-provider.module';

function makeConfig(
  values: Partial<EnvironmentVariables>,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: vi.fn((key: string) => (values as Record<string, unknown>)[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('buildSttProvider (SttProviderModule composition)', () => {
  it('binds the real OpenAI Whisper provider chain (Retrying + CircuitBreaker over OpenAiWhisperSttProvider) when OPENAI_API_KEY is set', () => {
    const provider = buildSttProvider(makeConfig({ OPENAI_API_KEY: 'sk-test-key' }));

    expect(provider).toBeInstanceOf(CircuitBreakerSttProvider);
    const retrying = (provider as unknown as { delegate: unknown }).delegate;
    expect(retrying).toBeInstanceOf(RetryingSttProvider);
    const openAiWhisper = (retrying as unknown as { delegate: unknown }).delegate;
    expect(openAiWhisper).toBeInstanceOf(OpenAiWhisperSttProvider);
  });

  it('never binds a FakeSttProvider when a real API key is present, even if ALLOW_FAKE_STT_PROVIDER is also true', () => {
    const provider = buildSttProvider(
      makeConfig({ OPENAI_API_KEY: 'sk-test-key', ALLOW_FAKE_STT_PROVIDER: true }),
    );

    expect(provider).not.toBeInstanceOf(FakeSttProvider);
    expect(provider).toBeInstanceOf(CircuitBreakerSttProvider);
  });

  it('binds a FakeSttProvider when the API key is missing AND ALLOW_FAKE_STT_PROVIDER is explicitly true', () => {
    const provider = buildSttProvider(makeConfig({ ALLOW_FAKE_STT_PROVIDER: true }));

    expect(provider).toBeInstanceOf(FakeSttProvider);
  });

  it('fails loudly (throws) when the API key is missing and ALLOW_FAKE_STT_PROVIDER is not set — never silently runs a fake in production', () => {
    expect(() => buildSttProvider(makeConfig({}))).toThrow(/OPENAI_API_KEY/);
  });

  it('fails loudly when the API key is missing and ALLOW_FAKE_STT_PROVIDER is explicitly false', () => {
    expect(() => buildSttProvider(makeConfig({ ALLOW_FAKE_STT_PROVIDER: false }))).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('the startup error never includes any credential value', () => {
    let message = '';
    try {
      buildSttProvider(makeConfig({}));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('sk-');
  });
});

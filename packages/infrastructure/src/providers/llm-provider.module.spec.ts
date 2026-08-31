import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { AnthropicLlmProvider } from './anthropic-llm-provider';
import { CircuitBreakerLlmProvider } from './circuit-breaker-llm-provider';
import { FakeLlmProvider } from './fake-llm-provider';
import { RetryingLlmProvider } from './retrying-llm-provider';
import { buildLlmProvider } from './llm-provider.module';

function makeConfig(
  values: Partial<EnvironmentVariables>,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: vi.fn((key: string) => (values as Record<string, unknown>)[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('buildLlmProvider (LlmProviderModule composition)', () => {
  it('binds the real Anthropic provider chain (Retrying + CircuitBreaker over AnthropicLlmProvider) when ANTHROPIC_API_KEY is set', () => {
    const provider = buildLlmProvider(makeConfig({ ANTHROPIC_API_KEY: 'sk-ant-test-key' }));

    expect(provider).toBeInstanceOf(CircuitBreakerLlmProvider);
    // The consuming code (application layer) only ever sees the LlmProvider
    // interface — this reaches into the decorator's private delegate only
    // to prove the composition, the same way the provider-swap spec does.
    const retrying = (provider as unknown as { delegate: unknown }).delegate;
    expect(retrying).toBeInstanceOf(RetryingLlmProvider);
    const anthropic = (retrying as unknown as { delegate: unknown }).delegate;
    expect(anthropic).toBeInstanceOf(AnthropicLlmProvider);
  });

  it('never binds a FakeLlmProvider when a real API key is present, even if ALLOW_FAKE_LLM_PROVIDER is also true', () => {
    const provider = buildLlmProvider(
      makeConfig({ ANTHROPIC_API_KEY: 'sk-ant-test-key', ALLOW_FAKE_LLM_PROVIDER: true }),
    );

    expect(provider).not.toBeInstanceOf(FakeLlmProvider);
    expect(provider).toBeInstanceOf(CircuitBreakerLlmProvider);
  });

  it('binds a FakeLlmProvider when the API key is missing AND ALLOW_FAKE_LLM_PROVIDER is explicitly true', () => {
    const provider = buildLlmProvider(makeConfig({ ALLOW_FAKE_LLM_PROVIDER: true }));

    expect(provider).toBeInstanceOf(FakeLlmProvider);
  });

  it('fails loudly (throws) when the API key is missing and ALLOW_FAKE_LLM_PROVIDER is not set — never silently runs a fake in production', () => {
    expect(() => buildLlmProvider(makeConfig({}))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('fails loudly when the API key is missing and ALLOW_FAKE_LLM_PROVIDER is explicitly false', () => {
    expect(() => buildLlmProvider(makeConfig({ ALLOW_FAKE_LLM_PROVIDER: false }))).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('the startup error never includes any credential value (there is none to include, but guards against a future regression)', () => {
    let message = '';
    try {
      buildLlmProvider(makeConfig({}));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('sk-ant');
  });
});

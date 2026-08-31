import { LlmProviderTimeoutError, LlmProviderUnavailableError } from '@afa/domain';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CircuitBreakerLlmProvider,
  DEFAULT_CIRCUIT_BREAKER_POLICY,
} from './circuit-breaker-llm-provider';

const REQUEST: LlmCompletionRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'test-model',
};
const RESULT: LlmCompletionResult = { content: 'ok', finishReason: 'stop' };
const FAILURE = new LlmProviderTimeoutError('test', 1000);

describe('CircuitBreakerLlmProvider', () => {
  let delegate: { complete: ReturnType<typeof vi.fn> };
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    delegate = { complete: vi.fn() };
    clock = 0;
  });

  it('has a sane default policy', () => {
    expect(DEFAULT_CIRCUIT_BREAKER_POLICY.failureThreshold).toBeGreaterThan(1);
    expect(DEFAULT_CIRCUIT_BREAKER_POLICY.cooldownMs).toBeGreaterThan(0);
  });

  it('passes calls through while Closed and resets the failure count on success', async () => {
    delegate.complete.mockResolvedValue(RESULT);
    const breaker = new CircuitBreakerLlmProvider(
      delegate as unknown as LlmProvider,
      'test',
      { failureThreshold: 2, cooldownMs: 1000 },
      now,
    );

    const result = await breaker.complete(REQUEST);

    expect(result).toEqual(RESULT);
    expect(breaker.getState()).toBe('closed');
  });

  it('opens after the configured number of consecutive failures', async () => {
    delegate.complete.mockRejectedValue(FAILURE);
    const breaker = new CircuitBreakerLlmProvider(
      delegate as unknown as LlmProvider,
      'test',
      { failureThreshold: 3, cooldownMs: 1000 },
      now,
    );

    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    expect(breaker.getState()).toBe('closed');
    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    expect(breaker.getState()).toBe('closed');
    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    expect(breaker.getState()).toBe('open');
  });

  it('fails immediately without calling the delegate while Open', async () => {
    delegate.complete.mockRejectedValue(FAILURE);
    const breaker = new CircuitBreakerLlmProvider(
      delegate as unknown as LlmProvider,
      'test',
      { failureThreshold: 1, cooldownMs: 5000 },
      now,
    );

    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    expect(breaker.getState()).toBe('open');
    delegate.complete.mockClear();

    await expect(breaker.complete(REQUEST)).rejects.toThrow(LlmProviderUnavailableError);
    expect(delegate.complete).not.toHaveBeenCalled();
  });

  it('allows a single Half-Open probe after the cooldown elapses, and closes on success', async () => {
    delegate.complete.mockRejectedValueOnce(FAILURE);
    const breaker = new CircuitBreakerLlmProvider(
      delegate as unknown as LlmProvider,
      'test',
      { failureThreshold: 1, cooldownMs: 5000 },
      now,
    );

    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    expect(breaker.getState()).toBe('open');

    clock += 5000;
    delegate.complete.mockResolvedValueOnce(RESULT);
    const result = await breaker.complete(REQUEST);

    expect(result).toEqual(RESULT);
    expect(breaker.getState()).toBe('closed');
  });

  it('reopens immediately if the Half-Open probe fails', async () => {
    delegate.complete.mockRejectedValue(FAILURE);
    const breaker = new CircuitBreakerLlmProvider(
      delegate as unknown as LlmProvider,
      'test',
      { failureThreshold: 1, cooldownMs: 5000 },
      now,
    );

    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    expect(breaker.getState()).toBe('open');

    clock += 5000;
    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE); // the Half-Open probe itself fails
    expect(breaker.getState()).toBe('open');
  });

  it('does not allow a probe before the cooldown has elapsed', async () => {
    delegate.complete.mockRejectedValue(FAILURE);
    const breaker = new CircuitBreakerLlmProvider(
      delegate as unknown as LlmProvider,
      'test',
      { failureThreshold: 1, cooldownMs: 5000 },
      now,
    );

    await expect(breaker.complete(REQUEST)).rejects.toThrow(FAILURE);
    clock += 4999;
    delegate.complete.mockClear();

    await expect(breaker.complete(REQUEST)).rejects.toThrow(LlmProviderUnavailableError);
    expect(delegate.complete).not.toHaveBeenCalled();
  });
});

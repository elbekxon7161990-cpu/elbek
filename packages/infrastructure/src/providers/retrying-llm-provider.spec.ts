import {
  LlmProviderAuthenticationError,
  LlmProviderInvalidRequestError,
  LlmProviderTimeoutError,
} from '@afa/domain';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETRY_POLICY, RetryingLlmProvider } from './retrying-llm-provider';

const REQUEST: LlmCompletionRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'test-model',
};
const RESULT: LlmCompletionResult = { content: 'ok', finishReason: 'stop' };

describe('RetryingLlmProvider', () => {
  let delegate: { complete: ReturnType<typeof vi.fn> };
  let delayFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delegate = { complete: vi.fn() };
    delayFn = vi.fn().mockResolvedValue(undefined);
  });

  it('has a sane default policy (retry once)', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(2);
    expect(DEFAULT_RETRY_POLICY.backoffMs).toBeGreaterThan(0);
  });

  it('returns the successful result on the first attempt without delaying', async () => {
    delegate.complete.mockResolvedValue(RESULT);
    const provider = new RetryingLlmProvider(
      delegate as unknown as LlmProvider,
      undefined,
      delayFn,
    );

    const result = await provider.complete(REQUEST);

    expect(result).toEqual(RESULT);
    expect(delegate.complete).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('retries once after a transient failure and succeeds', async () => {
    delegate.complete
      .mockRejectedValueOnce(new LlmProviderTimeoutError('test', 1000))
      .mockResolvedValueOnce(RESULT);
    const provider = new RetryingLlmProvider(
      delegate as unknown as LlmProvider,
      undefined,
      delayFn,
    );

    const result = await provider.complete(REQUEST);

    expect(result).toEqual(RESULT);
    expect(delegate.complete).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting the retry budget', async () => {
    const finalError = new LlmProviderTimeoutError('test', 1000);
    delegate.complete.mockRejectedValue(finalError);
    const provider = new RetryingLlmProvider(
      delegate as unknown as LlmProvider,
      { maxAttempts: 3, backoffMs: 10 },
      delayFn,
    );

    await expect(provider.complete(REQUEST)).rejects.toThrow(finalError);
    expect(delegate.complete).toHaveBeenCalledTimes(3);
  });

  it('never retries an authentication error', async () => {
    const authError = new LlmProviderAuthenticationError('test');
    delegate.complete.mockRejectedValue(authError);
    const provider = new RetryingLlmProvider(
      delegate as unknown as LlmProvider,
      undefined,
      delayFn,
    );

    await expect(provider.complete(REQUEST)).rejects.toThrow(authError);
    expect(delegate.complete).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('never retries an invalid-request error', async () => {
    const invalidError = new LlmProviderInvalidRequestError('test', 'bad model');
    delegate.complete.mockRejectedValue(invalidError);
    const provider = new RetryingLlmProvider(
      delegate as unknown as LlmProvider,
      undefined,
      delayFn,
    );

    await expect(provider.complete(REQUEST)).rejects.toThrow(invalidError);
    expect(delegate.complete).toHaveBeenCalledTimes(1);
  });
});

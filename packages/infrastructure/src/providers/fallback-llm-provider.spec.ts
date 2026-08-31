import { LlmProviderTimeoutError } from '@afa/domain';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';
import { describe, expect, it, vi } from 'vitest';

import { FallbackLlmProvider } from './fallback-llm-provider';

const REQUEST: LlmCompletionRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'test-model',
};
const PRIMARY_RESULT: LlmCompletionResult = { content: 'from primary', finishReason: 'stop' };
const SECONDARY_RESULT: LlmCompletionResult = { content: 'from secondary', finishReason: 'stop' };

describe('FallbackLlmProvider', () => {
  it('returns the primary’s result and never calls the secondary when the primary succeeds', async () => {
    const primary = { complete: vi.fn().mockResolvedValue(PRIMARY_RESULT) };
    const secondary = { complete: vi.fn() };
    const provider = new FallbackLlmProvider(
      primary as unknown as LlmProvider,
      secondary as unknown as LlmProvider,
    );

    const result = await provider.complete(REQUEST);

    expect(result).toEqual(PRIMARY_RESULT);
    expect(secondary.complete).not.toHaveBeenCalled();
  });

  it('falls back to the secondary when the primary fails', async () => {
    const primary = {
      complete: vi.fn().mockRejectedValue(new LlmProviderTimeoutError('primary', 1000)),
    };
    const secondary = { complete: vi.fn().mockResolvedValue(SECONDARY_RESULT) };
    const provider = new FallbackLlmProvider(
      primary as unknown as LlmProvider,
      secondary as unknown as LlmProvider,
    );

    const result = await provider.complete(REQUEST);

    expect(result).toEqual(SECONDARY_RESULT);
    expect(secondary.complete).toHaveBeenCalledWith(REQUEST);
  });

  it('throws the secondary’s error when both primary and secondary fail', async () => {
    const primary = {
      complete: vi.fn().mockRejectedValue(new LlmProviderTimeoutError('primary', 1000)),
    };
    const secondaryError = new LlmProviderTimeoutError('secondary', 1000);
    const secondary = { complete: vi.fn().mockRejectedValue(secondaryError) };
    const provider = new FallbackLlmProvider(
      primary as unknown as LlmProvider,
      secondary as unknown as LlmProvider,
    );

    await expect(provider.complete(REQUEST)).rejects.toThrow(secondaryError);
  });
});

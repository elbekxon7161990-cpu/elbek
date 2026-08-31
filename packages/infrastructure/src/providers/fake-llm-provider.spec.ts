import { LlmProviderTimeoutError } from '@afa/domain';
import type { LlmCompletionRequest } from '@afa/domain';
import { describe, expect, it } from 'vitest';

import { FakeLlmProvider } from './fake-llm-provider';

const REQUEST: LlmCompletionRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'test-model',
};

describe('FakeLlmProvider', () => {
  it('returns the default result when no step is queued', async () => {
    const provider = new FakeLlmProvider({ content: 'default', finishReason: 'stop' });

    const result = await provider.complete(REQUEST);

    expect(result).toEqual({ content: 'default', finishReason: 'stop' });
  });

  it('records the exact request it received (mapping-shape verification)', async () => {
    const provider = new FakeLlmProvider({ content: 'default', finishReason: 'stop' });

    await provider.complete(REQUEST);

    expect(provider.lastRequest).toEqual(REQUEST);
    expect(provider.callCount).toBe(1);
  });

  it('consumes scripted steps in order, then falls back to the default', async () => {
    const provider = new FakeLlmProvider({ content: 'default', finishReason: 'stop' })
      .enqueue({ result: { content: 'first', finishReason: 'stop' } })
      .enqueue({ result: { content: 'second', finishReason: 'stop' } });

    await expect(provider.complete(REQUEST)).resolves.toEqual({
      content: 'first',
      finishReason: 'stop',
    });
    await expect(provider.complete(REQUEST)).resolves.toEqual({
      content: 'second',
      finishReason: 'stop',
    });
    await expect(provider.complete(REQUEST)).resolves.toEqual({
      content: 'default',
      finishReason: 'stop',
    });
  });

  it('throws a scripted error', async () => {
    const error = new LlmProviderTimeoutError('fake', 500);
    const provider = new FakeLlmProvider({ content: 'default', finishReason: 'stop' }).enqueue({
      error,
    });

    await expect(provider.complete(REQUEST)).rejects.toThrow(error);
  });
});

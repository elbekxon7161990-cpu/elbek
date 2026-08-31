import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';
import { describe, expect, it } from 'vitest';

import { FakeLlmProvider } from './fake-llm-provider';

const REQUEST: LlmCompletionRequest = {
  messages: [{ role: 'user', content: 'spent 45000 on lunch' }],
  model: 'test-model',
};

/**
 * Stands in for "business logic" (what a future TASK-AI-001/002 use case
 * would look like) — it depends only on the `LlmProvider` port, never on a
 * concrete class.
 */
async function extractText(provider: LlmProvider, request: LlmCompletionRequest): Promise<string> {
  const result = await provider.complete(request);
  return result.content;
}

/**
 * A second, independent `LlmProvider` implementation — standing in for "a
 * different vendor's adapter" purely for this exercise. Not exported, not
 * wired anywhere; it exists only to prove the swap property below.
 */
class AlternativeVendorFakeProvider implements LlmProvider {
  async complete(_request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return { content: 'alternative vendor response', finishReason: 'stop' };
  }
}

describe('LlmProvider — provider-swap exercise (TASK-INFRA-010 Definition of Done)', () => {
  it('the same consuming code produces a correct result against provider A', async () => {
    const providerA: LlmProvider = new FakeLlmProvider({
      content: 'vendor A response',
      finishReason: 'stop',
    });

    const text = await extractText(providerA, REQUEST);

    expect(text).toBe('vendor A response');
  });

  it('swapping to a completely different provider implementation requires no change to the consuming code', async () => {
    const providerB: LlmProvider = new AlternativeVendorFakeProvider();

    // Identical call, identical function, only the injected instance changed.
    const text = await extractText(providerB, REQUEST);

    expect(text).toBe('alternative vendor response');
  });

  it('both providers satisfy the exact same contract shape', async () => {
    const providers: LlmProvider[] = [
      new FakeLlmProvider({ content: 'x', finishReason: 'stop' }),
      new AlternativeVendorFakeProvider(),
    ];

    for (const provider of providers) {
      const result = await provider.complete(REQUEST);
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('finishReason');
      expect(typeof result.content).toBe('string');
    }
  });
});
